////////////////////////////////////////////////////////////////////////////////
// EPIDEMIA Data Downloader (Version 3.3-ETH)
// Ethiopia National (ETH) version
// Coded by Dr. Mike Wimberly, Dr. Dawn Nekorchuk
// Contributions from: K. Ramharan Reddy
// University of Oklahoma, Department of Geography and Environmental Sustainability
// mcwimberly@ou.edu, dawn.nekorchuk@ou.edu
// Released 2022-11-15
////////////////////////////////////////////////////////////////////////////////


// Data Imports & Global variables
var woredas = ee.FeatureCollection(
  'users/dawneko/public/Eth_Admin_Woreda_2019_20200702');
    // Create region outer boundary to filter products.
var ethiopia = woredas.geometry().bounds();
var gpm = ee.ImageCollection('NASA/GPM_L3/IMERG_V06');
//Updated MOD11A2 product 
var lstTerra8 = ee.ImageCollection('MODIS/061/MOD11A2')  
    // After MCST outage
    .filterDate('2001-06-26', Date.now());
var brdfReflect = ee.ImageCollection('MODIS/006/MCD43A4');
var brdfQa = ee.ImageCollection('MODIS/006/MCD43A2');


// For interactions with UI & map

// Will be set later with parsed user input:
// User requested start and end dates.
// Initializing with a 0 date (1970-01-01).
var reqStartDate = ee.Date(0);
var reqEndDate = ee.Date(0);
// Modified start date to capture previous scene of 8-day MODIS data
var lstStartDate = ee.Date(0);
// Potential modified start dates if there is no data 
//  available in user request period.
// Collections will be filtered afterwards but it needs to run 
//  the rest of the code to generate empty file for export.
var brdfStartDate = ee.Date(0);
var precipStartDate = ee.Date(0);

// For calculated daily environmental data.
var dailyPrecip = ee.ImageCollection([]);
var dailyLst = ee.ImageCollection([]);
var dailyBrdf = ee.ImageCollection([]);

// For flattened (table) results for export.
var precipFlat = ee.FeatureCollection([]);
var lstFlat = ee.FeatureCollection([]);
var brdfFlat = ee.FeatureCollection([]);

// Specific filenames for export.
var precipFilename = '';
var lstFilename = '';
var brdfFilename = '';

// Declare global widgets.
var startDateInput;
var endDateInput;
var panel;
var calcButton;
var downloadButton;

// Reset results to prevent accidental data confusion:
function resetResults() {
  dailyPrecip = ee.ImageCollection([]);
  dailyLst = ee.ImageCollection([]);
  dailyBrdf = ee.ImageCollection([]);

  precipFlat = ee.FeatureCollection([]);
  lstFlat = ee.FeatureCollection([]);
  brdfFlat = ee.FeatureCollection([]);

  precipFilename = '';
  lstFilename = '';
  brdfFilename = '';
}

// Main Calculation function

// Main function to be kicked off upon user click on Calculate button
// 1. Date Prep
// 2*. Precipitation
// 3*. LST
// 4*. BRDF / Spectral
//    *Sections 2, 3, 4: contain subsections for filtering, calculating, summarizing
// 5. Export setup (separate function for export)

function calculateEnvVars(userStartDate, userEndDate) {
  // Step 1: Start Date prep
  
  // Parse user dates
  reqStartDate = ee.Date(userStartDate);
  reqEndDate = ee.Date(userEndDate);
  print('user req start date', reqStartDate);
  print('user req end date', reqEndDate);
  
  // LST Dates
  // LST MODIS is every 8 days, and user date will likely not match.
  // Want to get the latest previous image date
  //    i.e. the date the closest, but prior to, the user requested date.
  //    Will filter to requested later. 
  // Get date of first image.
  var lstEarliestDate = lstTerra8.first().date();
  // Filter collection to dates from beginning to requested start date. 
  var priorLstImgcol = lstTerra8.filterDate(lstEarliestDate, reqStartDate);
  // Get the latest (max) date of this collection of earlier images.
  var lstPrevMax = priorLstImgcol.reduceColumns({
    reducer: ee.Reducer.max(), 
    selectors: ['system:time_start']
  });
  lstStartDate =  ee.Date(lstPrevMax.get('max'));
  print('lstStartDate', lstStartDate);
  
  // Last available data dates
  // Different variables have different data lags. 
  // Data may not be available in user range.
  // To prevent errors from stopping script, 
  //  grab last available (if relevant) & filter at end.

  // Precipitation: 
  // Calculate date of most recent measurement for gpm (of all time)
  var gpmAllMax = gpm.reduceColumns({
    reducer: ee.Reducer.max(), 
    selectors: ['system:time_start']
  });
  var gpmAllEndDateTime =  ee.Date(gpmAllMax.get('max'));
  // GPM every 30 minutes, so get just date part
  var gpmAllEndDate = ee.Date.fromYMD({
    year: gpmAllEndDateTime.get('year'),
    month: gpmAllEndDateTime.get('month'),
    day: gpmAllEndDateTime.get('day')
  });
  // If data ends before requested start, take last data date,
  // otherwise use requested date.
  var precipStartDate = ee.Date(gpmAllEndDate.millis()
                                .min(reqStartDate.millis()));
  print('precipStartDate', precipStartDate);

  // BRDF 
  // Calculate date of most recent measurement for brdf (of all time).
  var brdfAllMax = brdfReflect.reduceColumns({
    reducer: ee.Reducer.max(), 
    selectors: ['system:time_start']
  });
  var brdfAllEndDate =  ee.Date(brdfAllMax.get('max'));
  // If data ends before requested start, take last data date,
  // otherwise use the requested date. 
  var brdfStartDate = ee.Date(brdfAllEndDate.millis()
                              .min(reqStartDate.millis()));
  print('brdfStartDate', brdfStartDate);
  print('brdfEndDate', brdfAllEndDate);
  
  // Step 2: Precipitation

  // Step 2a: Precipitation filtering and dates

  // Filter gpm by date, using modified start if necessary.
  var gpmFiltered = gpm
      .filterDate(precipStartDate, reqEndDate.advance(1, 'day'))
      .filterBounds(ethiopia)
      .select('precipitationCal');
  
  // Calculate date of most recent measurement for gpm 
  //  (in modified requested window).
  var gpmMax = gpmFiltered.reduceColumns({
    reducer: ee.Reducer.max(),
    selectors: ['system:time_start']
  });
  var gpmEndDate =  ee.Date(gpmMax.get('max'));
  var precipEndDate = gpmEndDate;
  print('precipEndDate ', precipEndDate);
  
  // Create list of dates for the precipitation time series
  var precipDays = precipEndDate.difference(precipStartDate, 'day');
  var precipDatesPrep = ee.List.sequence(0, precipDays, 1);
  function makePrecipDates(n) {
    return precipStartDate.advance(n, 'day');
  }
  var precipDates = precipDatesPrep.map(makePrecipDates);

  // Step 2b: Calculate daily precipitation
  
  // Function to calculate daily precipitation
  function calcDailyPrecip(curdate) {
      var curyear = ee.Date(curdate).get('year');
      var curdoy = ee.Date(curdate).getRelative('day', 'year').add(1);
      var totprec = gpmFiltered.select('precipitationCal')
            .filterDate(ee.Date(curdate), 
                        ee.Date(curdate).advance(1, 'day'))
            .sum()
            // Every half-hour.
            .multiply(0.5)
            .rename('totprec');
      return totprec
          .set('doy', curdoy)
          .set('year', curyear)
          .set('system:time_start', curdate);
  }
  // Map function over list of dates.
  var dailyPrecipExtended = 
      ee.ImageCollection.fromImages(precipDates.map(calcDailyPrecip));

  // Filter back to original user requested start date.
  dailyPrecip = dailyPrecipExtended
   .filterDate(reqStartDate, precipEndDate.advance(1, 'day'));

  // Step 2c: Summarize daily precipitation by woreda

  // Filter precip data for zonal summaries.
  var precipSummary = dailyPrecip
      .filterDate(reqStartDate, reqEndDate.advance(1, 'day'));
  // Function to calculate zonal statistics for precipitation by woreda.
  function sumZonalPrecip(image) { 
    // To get the doy and year, 
    // convert the metadata to grids and then summarize.
    var image2 = image.addBands([
      image.metadata('doy').int(), 
      image.metadata('year').int()
      ]);
    // Reduce by regions to get zonal means for each county.
    var output = image2.select(['year', 'doy', 'totprec'])
        .reduceRegions({
          collection: woredas,
          reducer: ee.Reducer.mean(),
          scale: 1000});
    return output;
  }
  // Map the zonal statistics function over the filtered precip data.
  var precipWoreda = precipSummary.map(sumZonalPrecip);         
  // Flatten the results for export.
  precipFlat = precipWoreda.flatten();

  // Step 3: LST

  // Step 3a: Calculate LST variables

  // Filter Terra LST by altered LST start date.
  //  Rarely, but at the end of the year if the last image is late in the year
  //  with only a few days in its period, it will sometimes not grab 
  //  the next image. Add extra padding to reqEndDate and
  //  it will be trimmed at the end.
  var lstFiltered = lstTerra8
      .filterDate(lstStartDate, reqEndDate.advance(8, 'day'))
      .filterBounds(ethiopia)
      .select('LST_Day_1km', 'QC_Day', 'LST_Night_1km', 'QC_Night');

  // Filter Terra LST by QA information.
  function filterLstQA(image) {
    var qaday = image.select(['QC_Day']); 
    var qanight = image.select(['QC_Night']); 
    var dayshift = qaday.rightShift(6);
    var nightshift = qanight.rightShift(6);
    var daymask = dayshift.lte(2);
    var nightmask = nightshift.lte(2);
    var outimage = ee.Image(image.select(['LST_Day_1km', 'LST_Night_1km']));
    var outmask = ee.Image([daymask, nightmask]);
    return outimage.updateMask(outmask);    
  }
  var lstFilteredQA = lstFiltered.map(filterLstQA);

  // Rescale temperature data and convert to degrees Celsius (C).
  function rescaleLst(image) {
    var lst_day = image.select('LST_Day_1km')
        .multiply(0.02)
        .subtract(273.15)
        .rename('lst_day');
    var lst_night = image.select('LST_Night_1km')
        .multiply(0.02)
        .subtract(273.15)
        .rename('lst_night');
    var lst_mean = image.expression(
      '(day + night) / 2', {
        'day': lst_day.select('lst_day'),
        'night': lst_night.select('lst_night')
      }
    ).rename('lst_mean');
    return image.addBands(lst_day)
                .addBands(lst_night)
                .addBands(lst_mean);
  }
  var lstVars = lstFilteredQA.map(rescaleLst);

  // Create list of dates for time series. 
  var lstRange = lstVars.reduceColumns({
    reducer: ee.Reducer.max(), 
    selectors: ['system:time_start']
  });
  var lstEndDate = ee.Date(lstRange.get('max')).advance(7, 'day');
  var lstDays = lstEndDate.difference(lstStartDate, 'day');
  var lstDatesPrep = ee.List.sequence(0, lstDays, 1);
  function makeLstDates(n) {
    return lstStartDate.advance(n, 'day');
  }
  var lstDates = lstDatesPrep.map(makeLstDates);

  // Step 3b: Calculate daily LST

  // Function to calculate daily LST by assigning the 8-day composite summary
  //  to each day in the composite period.
  function calcDailyLst(curdate) {
      var curyear = ee.Date(curdate).get('year');
      var curdoy = ee.Date(curdate).getRelative('day', 'year').add(1);
      var moddoy = curdoy.divide(8).ceil().subtract(1).multiply(8).add(1);
      var basedate = ee.Date.fromYMD(curyear, 1, 1);
      var moddate = basedate.advance(moddoy.subtract(1), 'day');
      var lst_day = lstVars
           .select('lst_day')
           .filterDate(moddate, moddate.advance(1, 'day'))
           .first()
           .rename('lst_day');    
      var lst_night = lstVars
           .select('lst_night')
           .filterDate(moddate, moddate.advance(1, 'day'))
           .first()
           .rename('lst_night');   
      var lst_mean = lstVars
           .select('lst_mean')
           .filterDate(moddate, moddate.advance(1, 'day'))
           .first()
           .rename('lst_mean');   
      return lst_day
          .addBands(lst_night)
          .addBands(lst_mean)
          .set('doy', curdoy)
          .set('year', curyear)
          .set('system:time_start', curdate);
  }
  // Map the function over the image collection.
  var dailyLstExtended = ee.ImageCollection.fromImages(lstDates.map(calcDailyLst));

  // Filter back to original user requested start date.
  dailyLst = dailyLstExtended
      .filterDate(reqStartDate, lstEndDate.advance(1, 'day'));

  // Step 3c: Summarize daily LST by woreda

  // Filter lst data for zonal summaries.
  var lstSummary = dailyLst
      .filterDate(reqStartDate, reqEndDate.advance(1, 'day'));
  // Function to calculate zonal statistics for lst by woreda
  function sumZonalLst(image) { 
    // To get the doy and year, we convert the metadata to grids 
    //  and then summarize. 
    var image2 = image.addBands([
      image.metadata('doy').int(), 
      image.metadata('year').int()
      ]);
    // Reduce by regions to get zonal means for each county
    // ORDER is important, must correspond to selection below.
    var reducers = ee.Reducer.mean().combine({ //doy
      reducer2: ee.Reducer.mean(),
      outputPrefix: 'year'})
      .combine({
        reducer2: ee.Reducer.mean(),
        outputPrefix: 'lst_day'})
        .combine({
          reducer2: ee.Reducer.mean(),
          outputPrefix: 'lst_night'})
          .combine({
            reducer2: ee.Reducer.mean(),
            outputPrefix: 'lst_mean'})
            .combine({
              reducer2: ee.Reducer.count(), //using the second lstday
                outputPrefix: 'pixels_lstd'})
                .combine({
                  reducer2: ee.Reducer.count(), //using the second lstnight
                  outputPrefix: 'pixels_lstn'})
                  .combine({
                    reducer2: ee.Reducer.count(), //using the second lstmean
                    outputPrefix: 'pixels_lstm'})
                    .combine({
                      reducer2: ee.Reducer.countEvery(),
                      outputPrefix: 'pixels_total'});
    // ORDER is important, must correspond to reducers above.
    var output = image2
    .select(['doy', 'year', 'lst_day', 'lst_night', 'lst_mean', 
             'lst_day', 'lst_night', 'lst_mean'], 
            ['doy', 'year', 'lst_day', 'lst_night', 'lst_mean', 
             'dayToCount', 'nightToCount', 'meanToCount'])
    .reduceRegions({
      collection: woredas,
      reducer: reducers,
      scale: 1000
    }); 
    return output;
  }
  // Map the zonal statistics function over the filtered lst data.
  var lstWoreda = lstSummary.map(sumZonalLst);  
  // Rename fields
  var lstNamesOld = ['NewPCODE', 'R_NAME', 'Z_NAME', 'W_NAME', 
                     'yearmean', 'mean', 
                     'lst_daymean', 'lst_nightmean', 'lst_meanmean', 
                     'pixels_lstdcount', 'pixels_lstncount', 
                     'pixels_lstmcount', 'pixels_totalcount']; 
  var lstNamesNew = ['NewPCODE', 'R_NAME', 'Z_NAME', 'W_NAME', 
                     'year', 'doy', 
                     'lst_day', 'lst_night', 'lst_mean', 
                     'pixels_lstd', 'pixels_lstn', 
                     'pixels_lstm', 'pixels_total']; 
  // Flatten the results for export.
  lstFlat = lstWoreda.flatten().select(lstNamesOld, lstNamesNew, false);

  // Step 4: BRDF / Spectral Indices

  // Step 4a: Calculate spectral indices

  // Filter BRDF-Adjusted Reflectance by Date
  var brdfReflectVars = brdfReflect
    .filterDate(brdfStartDate, reqEndDate.advance(1, 'day'))
    .filterBounds(ethiopia)
    .select(['Nadir_Reflectance_Band1', 'Nadir_Reflectance_Band2',
             'Nadir_Reflectance_Band3', 'Nadir_Reflectance_Band4',
             'Nadir_Reflectance_Band5', 'Nadir_Reflectance_Band6',
             'Nadir_Reflectance_Band7'],
            ['red', 'nir', 'blue', 'green', 'swir1', 'swir2', 'swir3']);
  
  // Filter BRDF QA by date.
  var brdfReflectQa = brdfQa
    .filterDate(brdfStartDate, reqEndDate.advance(1, 'day'))
    .filterBounds(ethiopia)
    .select(['BRDF_Albedo_Band_Quality_Band1', 'BRDF_Albedo_Band_Quality_Band2', 
             'BRDF_Albedo_Band_Quality_Band3', 'BRDF_Albedo_Band_Quality_Band4', 
             'BRDF_Albedo_Band_Quality_Band5', 'BRDF_Albedo_Band_Quality_Band6',
             'BRDF_Albedo_Band_Quality_Band7', 'BRDF_Albedo_LandWaterType'],
            ['qa1', 'qa2', 'qa3', 'qa4', 'qa5', 'qa6', 'qa7', 'water']);
  
  // Join the 2 collections. 
  var idJoin = ee.Filter.equals({
    leftField: 'system:time_end', 
    rightField: 'system:time_end'
  });
  // Define the join. 
  var innerJoin = ee.Join.inner('NBAR', 'QA');
  // Apply the join. 
  var brdfJoined = innerJoin.apply(brdfReflectVars, brdfReflectQa, idJoin);

  // Add QA bands to the NBAR collection
  function addQaBands(image){
      var nbar = ee.Image(image.get('NBAR'));
      var qa = ee.Image(image.get('QA')).select(['qa2']);
      var water = ee.Image(image.get('QA')).select(['water']);
      return nbar.addBands([qa, water]);
  }
  var brdfMerged = ee.ImageCollection(brdfJoined.map(addQaBands));

  // Function to mask out pixels based on qa and water/land flags: 
  function filterBrdf(image) {
    // Using QA info for the NIR band. 
    var qaband = image.select(['qa2']); 
    var wband = image.select(['water']);
    var qamask = qaband.lte(2).and(wband.eq(1));
    var nir_r = image.select('nir').multiply(0.0001).rename('nir_r');
    var red_r = image.select('red').multiply(0.0001).rename('red_r');
    var swir1_r = image.select('swir1').multiply(0.0001).rename('swir1_r');
    var swir2_r = image.select('swir2').multiply(0.0001).rename('swir2_r');
    var blue_r = image.select('blue').multiply(0.0001).rename('blue_r');
    return image.addBands(nir_r)
                .addBands(red_r)
                .addBands(swir1_r)
                .addBands(swir2_r)
                .addBands(blue_r)
                .updateMask(qamask);  
  }
  var brdfFilteredVars = brdfMerged.map(filterBrdf);

  // Function to calculate spectral indices:
  function calcBrdfIndices(image) {
    var curyear = ee.Date(image.get('system:time_start')).get('year');
    var curdoy = ee.Date(image.get('system:time_start'))
        .getRelative('day', 'year').add(1);
    var ndvi = image.normalizedDifference(['nir_r', 'red_r'])
        .rename('ndvi');
    var savi = image.expression(
      '1.5 * (nir - red) / (nir + red + 0.5)', {
        'nir': image.select('nir_r'),
        'red': image.select('red_r')
      }
    ).rename('savi');
    var evi = image.expression(
      '2.5 * (nir - red) / (nir + 6 * red - 7.5 * blue + 1)', {
        'nir': image.select('nir_r'),
        'red': image.select('red_r'),
        'blue': image.select('blue_r')
      }
    ).rename('evi');
    var ndwi5 = image.normalizedDifference(['nir_r', 'swir1_r'])
         .rename('ndwi5');
    var ndwi6 = image.normalizedDifference(['nir_r', 'swir2_r'])
         .rename('ndwi6');

    return image.addBands(ndvi)
                .addBands(savi)
                .addBands(evi)
                .addBands(ndwi5)
                .addBands(ndwi6)
                .set('doy', curdoy)
                .set('year', curyear);
  }
  // Map function over image collection.
  brdfFilteredVars = brdfFilteredVars.map(calcBrdfIndices);

  // Create list of dates for full time series.
  var brdfRange = brdfFilteredVars.reduceColumns({
    reducer: ee.Reducer.max(), 
    selectors: ['system:time_start']
  });
  var brdfEndDate = ee.Date(brdfRange.get('max'));
  var brdfDays = brdfEndDate.difference(brdfStartDate, 'day');
  var brdfDatesPrep = ee.List.sequence(0, brdfDays, 1);
  function makeBrdfDates(n) {
    return brdfStartDate.advance(n, 'day');
  }
  var brdfDates = brdfDatesPrep.map(makeBrdfDates);

  // List of dates that exist in BRDF data.
  var brdfDatesExist = brdfFilteredVars
    .aggregate_array('system:time_start');

  // Step 4b: Calculate daily spectral indices
  
  // Get daily brdf values.
  function calcDailyBrdfExists(curdate) {
      curdate = ee.Date(curdate);
      var curyear = curdate.get('year');
      var curdoy = curdate.getRelative('day', 'year').add(1);
      var brdfTemp = brdfFilteredVars
          .filterDate(curdate, curdate.advance(1, 'day'));
      var outImg = brdfTemp.first(); 
      return outImg;
  }
  var dailyBrdfExtExists = 
      ee.ImageCollection.fromImages(brdfDatesExist.map(calcDailyBrdfExists));

  // Create empty result, to fill in dates when BRDF data does not exist.
  function calcDailyBrdfFiller(curdate) {
      curdate = ee.Date(curdate);
      var curyear = curdate.get('year');
      var curdoy = curdate.getRelative('day', 'year').add(1);
      var brdfTemp = brdfFilteredVars
          .filterDate(curdate, curdate.advance(1, 'day'));
      var brdfSize = brdfTemp.size();
      var outImg = ee.Image.constant(0).selfMask()
           .addBands(ee.Image.constant(0).selfMask())
           .addBands(ee.Image.constant(0).selfMask())
           .addBands(ee.Image.constant(0).selfMask())
           .addBands(ee.Image.constant(0).selfMask())
           .rename(['ndvi', 'evi', 'savi', 'ndwi5', 'ndwi6'])
           .set('doy', curdoy)
           .set('year', curyear)
           .set('system:time_start', curdate)
           .set('brdfSize', brdfSize);
      return outImg;
  }
  // Create filler for all dates.
  var dailyBrdfExtendedFiller = 
      ee.ImageCollection.fromImages(brdfDates.map(calcDailyBrdfFiller));
  // But only use if and when size was 0.
  var dailyBrdfExtFillFilt = dailyBrdfExtendedFiller
      .filter(ee.Filter.eq('brdfSize', 0));

  // Merge the two collections.
  var dailyBrdfExtended = dailyBrdfExtExists
      .merge(dailyBrdfExtFillFilt);

  // Filter back to original user requested start date.
  dailyBrdf = dailyBrdfExtended
    .filterDate(reqStartDate, brdfEndDate.advance(1, 'day'));


  // Step 4c: Summarize daily spectral indices by woreda

  // Filter spectral indices for zonal summaries.
  var brdfSummary = dailyBrdf
      .filterDate(reqStartDate, reqEndDate.advance(1, 'day'));
  // Function to calculate zonal statistics for spectral indices by county:
  function sumZonalBrdf(image) { 
    // To get the doy and year, we convert the metadata to grids and then summarize
    var image2 = image.addBands([
      image.metadata('doy').int(), 
      image.metadata('year').int()]);
    // Reduce by regions to get zonal means for each feature.
    // ORDER is important, must correspond to selection below.
    var reducers = ee.Reducer.mean().combine({ //doy
      reducer2: ee.Reducer.mean(),
      outputPrefix: 'year'})
      .combine({
        reducer2: ee.Reducer.mean(),
        outputPrefix: 'ndvi'})
        .combine({
          reducer2: ee.Reducer.mean(),
          outputPrefix: 'savi'})
          .combine({
            reducer2: ee.Reducer.mean(),
            outputPrefix: 'evi'})
            .combine({
              reducer2: ee.Reducer.mean(),
              outputPrefix: 'ndwi5'})
              .combine({
                reducer2: ee.Reducer.mean(),
                outputPrefix: 'ndwi6'})
                .combine({
                  reducer2: ee.Reducer.count(), //using the 'extra' ndvi
                  outputPrefix: 'good_pixels'})
                  .combine({
                    reducer2: ee.Reducer.countEvery(), //0-input reducer, does not need a band
                    outputPrefix: 'total_pixels'});
    // ORDER is important, must correspond to reducers above. 
    var output = image2
    // The extra ndvi at the end is for counting pixels. 
    .select(['doy', 'year', 'ndvi', 'savi', 'evi', 'ndwi5', 'ndwi6', 'ndvi'],  
            ['doy', 'year', 'ndvi', 'savi', 'evi', 'ndwi5', 'ndwi6', 'tocount'])
    .reduceRegions({
      collection: woredas,
      reducer: reducers,
      scale: 500}); //NBAR product 500 meter, using same scale for LST reducers
    return output;
  }
  // Map the zonal statistics function over the filtered spectral index data.
  var brdfWoreda = brdfSummary.map(sumZonalBrdf); 

  // Flatten the results for export
  var brdfNamesOld = ['NewPCODE', 'R_NAME', 'Z_NAME', 'W_NAME', 
                      'yearmean', 'mean', 
                      'ndvimean', 'savimean', 'evimean', 'ndwi5mean', 'ndwi6mean', 
                      'good_pixelscount', 'total_pixelscount', ];
  var brdfNamesNew = ['NewPCODE', 'R_NAME', 'Z_NAME', 'W_NAME', 
                      'year', 'doy', 
                      'ndvi', 'savi', 'evi', 'ndwi5', 'ndwi6', 
                      'pixels_ndvi', 'pixels_total'];
  brdfFlat = brdfWoreda.flatten().select(brdfNamesOld, brdfNamesNew, false);

  // Step 5: Exporting Set-up

  //To prevent the UI from hanging while it is calculating
  // the end dates for the download file names (old getInfo() calls)
  // We create a function that we will call asynchronously via evaluate()
  // That will do the waiting for results without hanging the UI.
  
  function afterCalculate(data){
    var precipSummaryEndDate = data.precipDate; //data[0];
    precipFilename = precipPrefix
      .concat('_', userStartDate, 
              '_', precipSummaryEndDate);

   var lstSummaryEndDate = data.lstDate; //data[1];
    lstFilename = lstPrefix
      .concat('_', userStartDate, 
            '_', lstSummaryEndDate);  
  
    var brdfSummaryEndDate = data.brdfDate; //data[2];
    brdfFilename = brdfPrefix
      .concat('_', userStartDate, 
              '_', brdfSummaryEndDate);
  
    print(precipFilename, lstFilename, brdfFilename);
    
    displayResults();
  }
  
  //Dictionary collector for things to evaluate
  //var dataList = [];
  var fileDateDictionary = {}; 
  
  //Precipitation
  var precipPrefix = 'export_precip_data';
  var precipLastDate = ee.Date(reqEndDate.millis()
      .min(precipEndDate.millis())).format('yyyy-MM-dd');
  //dataList.push(precipLastDate);
  fileDateDictionary.precipDate = precipLastDate;
  
  //LST
  var lstPrefix = 'export_lst_data';
  var lstLastDate = ee.Date(reqEndDate.millis()
      .min(lstEndDate.millis())).format('yyyy-MM-dd');
  //dataList.push(lstLastDate);      
  fileDateDictionary.lstDate = lstLastDate;

        
  //BRDF
  var brdfPrefix = 'export_spectral_data';
  var brdfLastDate = ee.Date(reqEndDate.millis()
      .min(brdfEndDate.millis())).format('yyyy-MM-dd');
  //dataList.push(brdfLastDate);
  fileDateDictionary.brdfDate = brdfLastDate;

  //Now call asynchronous evaluation
  //ee.List(dataList).evaluate(afterCalculate);
  ee.Dictionary(fileDateDictionary).evaluate(afterCalculate);

} //end calculateEnvVars

// Function for Drive exporting

// For when script is run in Code Editor with access to Tasks:
function exportToDrive(){
  
  // Export flattened tables to Google Drive.
  // Need to click 'RUN in the Tasks tab to configure and start each export.
  Export.table.toDrive({
    collection: precipFlat,
    description: precipFilename,
    selectors: ['NewPCODE', 'R_NAME','Z_NAME','W_NAME', 'year', 'doy', 'totprec']
  });
  Export.table.toDrive({
    collection: lstFlat, 
    description: lstFilename,
    selectors: ['NewPCODE', 'R_NAME', 'Z_NAME', 'W_NAME', 'year', 'doy', 
                'lst_day', 'lst_night', 'lst_mean', 
                'pixels_lstd', 'pixels_lstn', 'pixels_lstm', 'pixels_total']
  });
  Export.table.toDrive({
    collection: brdfFlat, 
    description: brdfFilename,
    selectors: ['NewPCODE', 'R_NAME', 'Z_NAME', 'W_NAME', 'year', 'doy', 
                'ndvi', 'savi', 'evi', 'ndwi5', 'ndwi6', 
                'pixels_ndvi', 'pixels_total']
 });
}

// Separate function for final exporting in app and new UI panel:
function exportSummaries(){

  //Because this can also hang the UI, 
  // we will create these asynchronously.
  
  function generateUrls(ignoreData){

  //Flattened tables are global
  // so we are not using flatDictionary
  // which really only existed to run evaluate from
  // Quite possibly a better way to do this, but 
  // might also involve issues with callbacks / variable passing
    var precipURL = precipFlat
        .getDownloadURL({
          format: 'csv',
          filename: precipFilename,
          selectors: ['NewPCODE', 'R_NAME','W_NAME','Z_NAME', 'year', 'doy', 'totprec']
    });
    var lstURL = lstFlat
        .getDownloadURL({
          format: 'csv',
          filename: lstFilename,
          selectors: ['NewPCODE', 'R_NAME', 'Z_NAME', 'W_NAME', 'year', 'doy', 
                      'lst_day', 'lst_night', 'lst_mean', 
                      'pixels_lstd', 'pixels_lstn', 'pixels_lstm', 'pixels_total']
    });
    var brdfURL = brdfFlat
        .getDownloadURL({
          format: 'csv',
          filename: brdfFilename,
          selectors: ['NewPCODE', 'R_NAME', 'Z_NAME', 'W_NAME', 'year', 'doy', 
                      'ndvi', 'savi', 'evi', 'ndwi5', 'ndwi6', 
                      'pixels_ndvi', 'pixels_total']
    });
    
    // Add download links to UI.
    // Adapted from TC Chakraborty Global Surface UHI Explorer.
    // Link construction:
    var linkSection = ui.Chart(
      [
        ['Download data'],
        ['<a target = "_blank" href = ' + precipURL + '>' + 
        'Precipitation</a>'],
        ['<a target = "_blank" href = ' + lstURL + '>' + 
        'Land Surface Temperatures</a>'],
        ['<a target = "_blank" href = ' + brdfURL + '>' + 
        'Spectral Indicies</a>'],
      ],
      'Table', {allowHtml: true});
      // Make link panel.
      downloadPanel = ui.Panel({
        widgets: [linkSection], 
        layout: ui.Panel.Layout.Flow('vertical')
      });
      sidePanel.add(downloadPanel);
    
    //Update button text
    downloadButton.setLabel('(See below)');
  
  }
  
  //flattened table dictionary to run eval off of
  var flatDictionary = {
    precipFlatKey: precipFlat,
    lstFlatKey: lstFlat,
    brdfFlatKey: brdfFlat
  };
  
  // Generate URLs asynchronously, and displays links when done
  ee.Dictionary(flatDictionary).evaluate(generateUrls);
  
}

// User interface (UI)

// Initialize some UI-related variables. 
var map = ui.Map();
var sidePanel = ui.Panel();
var resultsPanel = ui.Panel();
var downloadPanel = ui.Panel();
// Will be used in UI default dates. 
var now = Date.now(); 

var config = {
  // 28 days before today
  initialStartDate: ee.Date(now)
    .advance(-28, 'days')
    .format('YYYY-MM-dd').getInfo(),
  // Today
  initialEndDate: ee.Date(now)
    .format('YYYY-MM-dd').getInfo(),
  initialCalcButtonText: 'Click to summarize',
};

// Palettes for environmental variable maps:
var palettePrecip = ['f7fbff', '08306b']; 
var paletteLST = ['fff5f0', '67000d']; 
var paletteSpectral = ['ffffe5', '004529']; 


function makeSidePanel(title, description) {
  title = ui.Label({
    value: title,
    style: {
      fontSize: '18px',
      fontWeight: '400',
      padding: '10px',
    }
  });
  description = ui.Label({
    value: description,
    style: {
      color: 'gray',
      padding: '10px',
    }
  });
  return ui.Panel({
    widgets: [title, description],
    style: {
      height: '100%',
      width: '30%',
    },
  });
}

function initializeWidgets() {
  
  panel = ui.Panel();

  // Start date box:
  var startDateLabel = ui.Label({
    value: 'Start Date for Summary (YYYY-MM-DD). ' + 
     'For this script, the earliest start date is 2001-06-26 for LST data.',
  });
  panel.add(startDateLabel);
  startDateInput = ui.Textbox({
    value: config.initialStartDate,
    onChange: function(value) {
      // Reset calculation button.
      calcButton.setLabel(config.initialCalcButtonText);
      // Reset results and summaries.
      panel.remove(resultsPanel);
      sidePanel.remove(downloadPanel);
      resetResults();
      // Reset map.
      map.clear();
      drawBaseMap();
      // Set value. 
      startDateInput.setValue(value);
      return(value);
    }
  });
  panel.add(startDateInput);

  // End date box:
  var endDateLabel = ui.Label({
    value: 'End Date for Summary (YYYY-MM-DD):',
  });
  panel.add(endDateLabel);
  endDateInput = ui.Textbox({
    value: config.initialEndDate,
      onChange: function(value) {
      // Reset calculation button. 
      calcButton.setLabel(config.initialCalcButtonText);
      // Reset results and summary.
      panel.remove(resultsPanel);
      sidePanel.remove(downloadPanel);
      resetResults();
      // Reset map.
      map.clear();
      drawBaseMap();
      // Set value.
      endDateInput.setValue(value);
      return(value);
    }
  });
  panel.add(endDateInput);
  
  // Calculate button
  var calcButtonLabel = ui.Label({
    value: '2. Calculate environmental variables for selected dates. ' +
      'These steps will take several seconds, please be patient.',
    style: {fontWeight: 'bold'}
  });
  panel.add(calcButtonLabel);
  calcButton = ui.Button({
    label: config.initialCalcButtonText,
    onClick: function(button) {
      button.setLabel('(Calculating)');
      // Call main calculation script with user set dates.
      calculateEnvVars(startDateInput.getValue(), 
                      endDateInput.getValue());
    }
  });
  panel.add(calcButton);
  return panel;
}

function displayResults() {
  // Only run this function once all the data has been populated.
  // Create new results panel & display.
  resultsPanel = createResultsPanel(startDateInput.getValue(), 
                                    endDateInput.getValue());
  panel.add(resultsPanel);
  calcButton.setLabel('(See below)');
  // Add tasks for Drive Export. 
  exportToDrive();
}

function drawEnvMap(dtRange) {
  // dtRange is from from a UI date slider
  // and is the date range to show the envirnonmental variables.

  // Filter image collections based on slider value.
  var brdfDisp = dailyBrdf
      .filterDate(dtRange.start(), dtRange.end());
  var lstDisp = dailyLst
      .filterDate(dtRange.start(), dtRange.end());
  var precipDisp = dailyPrecip
      .filterDate(dtRange.start(), dtRange.end());
  
  // Select the image (should be only one) from each collection.
  var precipImage = precipDisp.first().select('totprec');
  var lstdImage = lstDisp.first().select('lst_day');
  var lstmImage = lstDisp.first().select('lst_mean');
  var ndviImage = brdfDisp.first().select('ndvi');
  var ndwi6Image = brdfDisp.first().select('ndwi6');

  // Reset map.
  map.clear();
  drawBaseMap();

  // Add layers to the map viewer.
  // Showing precipitation by default, 
  //  others hidden until users pick them from layers drop down menu.
  map.addLayer({eeObject: precipImage, 
                visParams: {min: 0, max: 20, palette: palettePrecip},
                name:'Precipitation', 
                shown: true, 
                opacity: 0.75});
  map.addLayer({eeObject: lstdImage, 
              visParams: {min: 0, max: 40, palette: paletteLST}, 
              name: 'LST Day', 
              shown: false, 
              opacity: 0.75});
  map.addLayer({eeObject: lstmImage, 
              visParams: {min: 0, max: 40, palette: paletteLST}, 
              name: 'LST Mean', 
              shown: false, 
              opacity: 0.75});
  map.addLayer({eeObject: ndviImage, 
              visParams: {min: 0, max: 1, palette: paletteSpectral}, 
              name: 'NDVI', 
              shown: false, 
              opacity: 0.75});
  map.addLayer({eeObject: ndwi6Image, 
              visParams: {min: 0, max: 1, palette: paletteSpectral}, 
              name: 'NDWI6', 
              shown: false, 
              opacity: 0.75});
}

function createResultsPanel(userStartDate, userEndDate) {
    
    // Date slider for displaying env data on map
    var dateLabel = ui.Label({
      value: 'Optional, for VISUALIZATION of layers on the map: ' + 
             'Pick a date to show environmental data. ' +
             'Choose layers from the layer menu in the upper right of map (using the checkbox). ' + 
             'Some layers may not yet be available close to the current date.'});
    var dateDisplay = ui.DateSlider({
      start: userStartDate,
      end: ee.Date(userEndDate).advance(1, 'day')
            .format('YYYY-MM-dd').getInfo(),
      value: userStartDate,
      onChange: function(value){
        // Note: value is a DateRange.
        // Draw the updated map. 
        drawEnvMap(value);
        }
    });
    // Wrap in a panel to group label and slider. 
    var pickDateDisplay = ui.Panel([
      dateLabel,
      dateDisplay
    ]);

  var dayCount = ee.Date(userEndDate)
                .difference(ee.Date(userStartDate), 'days')
                .add(1);

  var dayLabel = ui.Label('Number of days selected: ' + dayCount.getInfo());

  // Download button for user to click:
  downloadButton = ui.Button({
    label:'3. Get download links for woreda summary CSV files',
    onClick: function(button) {
      button.setLabel('(Generating download links)');
      //Create links and show,
      //and create Tasks (for when in code editor). 
      exportSummaries();
    }
  });
  
  // Set ~9 months of data at a time as a hard limit 
  //  trying to prevent timeout errors for the user.
  downloadButton.style().set('shown', Boolean(dayCount.lte(280).getInfo()));

  var resultsUI = ui.Panel([pickDateDisplay,
                            dayLabel,
                            downloadButton]);
  return resultsUI;
}


function drawBaseMap() {
  
  // Display the outline of woredas as a black line with no fill.
  // Create an empty image into which to paint the features, cast to byte.
  var empty = ee.Image().byte();
  // Paint all the polygon edges with the same number and width, display.
  var outline = empty.paint({
    featureCollection: woredas,
    color: 1,
    width: 1
  });
  map.addLayer(outline, {palette: '000000'}, 'Woredas');
}

function init() {
  
  // Set up default map:
  map.setCenter(40.5, 9.5, 6);
  drawBaseMap();
  
  sidePanel = makeSidePanel(
    'Retrieving Environmental Analytics for Climate and Health (REACH)',
    'Generates daily environmental data summarized by woreda, ' +
      'for use in the EPIDEMIA system for forecasting malaria. ' +
      'Version 3.4-ETH.'
    );
    
  // Links to an external references.
  var packageLink = ui.Label(
      'R package epidemiar', 
      {},
      'https://github.com/EcoGRAPH/epidemiar');
  //sidePanel.add(packageLink);
  var websiteLink = ui.Label(
    'EcoGRAPH EPIDEMIA webpage', 
    {},
    'http://ecograph.net/epidemia/');
  //sidePanel.add(websiteLink);
  var codeLink = ui.Label(
    'Access to Code Editor version (must have Google Earth Engine account)',
    {},
    'https://code.earthengine.google.com/d5ed6dd135dfb5d8bb8e3c86292456cb');
  var moreInfoPanel = ui.Panel({
    widgets: [//ui.Label('', {}), 
              //packageLink, 
              websiteLink,
              codeLink],
    style: {padding: '0px 0px 0px 10px'}}
    );
  sidePanel.add(moreInfoPanel);

  var descriptionText = 
  '1. Enter a date range to download data. ' +
  'Please request only a few months at one time, ' + 
  'otherwise it may time out.';
  sidePanel.add(ui.Label({
    value: descriptionText,
    style: {fontWeight: 'bold'}
  }));
  var widgetPanel = initializeWidgets();
  sidePanel.add(widgetPanel);
  
  var splitPanel = ui.SplitPanel({
    firstPanel: sidePanel,
    secondPanel: map,
  });
  ui.root.clear();
  ui.root.add(splitPanel);
}

init(); 


