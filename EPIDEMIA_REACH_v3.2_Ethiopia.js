////////////////////////////////////////////////////////////////////////////////
// EPIDEMIA Data Downloader (Version 3.2-ETH)
// Ethiopia National (ETH) version
// Coded by Dr. Mike Wimberly, Dr. Dawn Nekorchuk
// Contributions from: K. Ramharan Reddy
// University of Oklahoma, Department of Geography and Environmental Sustainability
// mcwimberly@ou.edu, dawn.nekorchuk@ou.edu
// Released 2021-06-01
////////////////////////////////////////////////////////////////////////////////

////////////////////////////////////////////////////////////////////////////////
//
// Data Imports & Global variables
//
var woreda = ee.FeatureCollection("users/dawneko/public/Eth_Admin_Woreda_2019_20200702"),
    gpm = ee.ImageCollection("NASA/GPM_L3/IMERG_V06"),
    lstTerra8 = ee.ImageCollection("MODIS/006/MOD11A2")
                //after MCST outage
                .filterDate('2001-06-26', Date.now()),
    brdfReflect = ee.ImageCollection("MODIS/006/MCD43A4"),
    brdfQA = ee.ImageCollection("MODIS/006/MCD43A2");

// Will be set with parsed user input
// User requested start and end dates
// Initializing with a 0 date (1970-01-01)
var reqStartDate = ee.Date(0);
var reqEndDate = ee.Date(0);
// Modified start date to capture previous scene of 8-day MODIS data
var lstStartDate = ee.Date(0);
// Potential modified start dates if there is no data available in user request period
// Will be filtered out later, but need it to run the rest of the code to generate empty file
var brdfStartDate = ee.Date(0);
var precipStartDate = ee.Date(0);

// Calculated daily environmental data
var dailyPrecip = ee.ImageCollection([]);
var dailyLst = ee.ImageCollection([]);
var dailyBrdf = ee.ImageCollection([]);

// Flattened (table) results to export
var precipFlat = ee.FeatureCollection([]);
var lstFlat = ee.FeatureCollection([]);
var brdfFlat = ee.FeatureCollection([]);

// Specific filenames for export, all local
var precipFilename = '';
var lstFilename = '';
var brdfFilename = '';

//function to reset results to prevent accidental data confusion
function resetResults(){
  
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




////////////////////////////////////////////////////////////////////////////////
//
// Main Calculation function
//

// Main function to be kicked off upon user click on Calculate button
// 1. Date Prep
// 2*. Precipitation
// 3*. LST
// 4*. BRDF / Spectral
//    *Sections 2, 3, 4: contain subsections for filtering, calculating, summarizing
// 5. Export setup (separate function for export)

function calculateEnvVars(userStartDate, userEndDate){
  
  ////////////////////////////////////////////////////////////////////////////////
  // Step 1: Start Date prep
  
  // Parse user dates
  reqStartDate = ee.Date(userStartDate);
  reqEndDate = ee.Date(userEndDate);
  print('user req start date', reqStartDate);
  print('user req end date', reqEndDate);
  
  // LST Dates
  // LST MODIS is every 8 days, and user date will likely not match
  // Want to get the latest previous image date
  //    i.e. the date the closest, but prior to, the user requested date.
  //    Will filter to requested later. 
  // Get date of first image
  var lstEarliestDate = lstTerra8.first().date();
  // Filter collection to dates from beginning to requested 
  var priorLstImgcol = lstTerra8.filterDate(lstEarliestDate, reqStartDate);
  // Get the latest (max) date of this collection of earlier images
  var lstPrevMax = priorLstImgcol.reduceColumns(ee.Reducer.max(), ["system:time_start"]);
  lstStartDate =  ee.Date(lstPrevMax.get('max'));
  print('lstStartDate', lstStartDate);
  
  // Last available data dates
  // Data lags depending on variable. Data may not be available in user range.
  // To prevent errors from stopping script, grab last available (if relevant) & filter at end.
  // Precip 
  // Calculate date of most recent measurement for gpm (of all time)
  var gpmAllMax = gpm.reduceColumns(ee.Reducer.max(), ["system:time_start"]);
  var gpmAllEndDateTime =  ee.Date(gpmAllMax.get('max'));
  // GPM every 30 minutes, so get just date part
  var gpmAllEndDate = ee.Date.fromYMD({
    year: gpmAllEndDateTime.get('year'),
    month: gpmAllEndDateTime.get('month'),
    day: gpmAllEndDateTime.get('day')
  });
  //print('gpmAllEndDate.millis ', gpmAllEndDate.millis());
  //print('reqStartDate.millis ', reqStartDate.millis());
  //print('less than?', gpmAllEndDate.millis().lt(reqStartDate.millis()));
  precipStartDate = ee.Date(ee.Algorithms.If(gpmAllEndDate.millis().lt(reqStartDate.millis()),
                                      //if data ends before requested start, take last data date
                                      gpmAllEndDate,
                                      //otherwise use requested date as normal
                                      reqStartDate));
  print('precipStartDate', precipStartDate);
  // BRDF 
  // Calculate date of most recent measurement for brdf (of all time)
  var brdfAllMax = brdfReflect.reduceColumns(ee.Reducer.max(), ["system:time_start"]);
  var brdfAllEndDate =  ee.Date(brdfAllMax.get('max'));
  brdfStartDate = ee.Date(ee.Algorithms.If(brdfAllEndDate.millis().lt(reqStartDate.millis()),
                                      //if data ends before requested start, take last data date
                                      brdfAllEndDate,
                                      //otherwise use requested date as normal
                                      reqStartDate));
  print('brdfStartDate', brdfStartDate);
  
  // // Create list of dates for time series
  // var nDays = reqEndDate.difference(reqStartDate, 'day'); 
  // var datesPrep = ee.List.sequence(0, nDays, 1);
  // function makeDateList(n) {
  //   return reqStartDate.advance(n, 'day');
  // }
  // var dates = datesPrep.map(makeDateList);
  // print('dates', dates);
  
  ////////////////////////////////////////////////////////////////////////////////
  // Step 2: Precipitation

  ////////////////////////////////////////////////////////////////////////////////
  // Step 2a: Precipitation filtering and dates

  // Filter gpm by date, using modified start if necessary
  var gpmFiltered = gpm
    .filterDate(precipStartDate, reqEndDate.advance(1, 'day'))
    .select('precipitationCal');
  
  // Calculate date of most recent measurement for gpm (in modified requested window)
  var gpmMax = gpmFiltered.reduceColumns(ee.Reducer.max(), ["system:time_start"]);
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
  //print('precipDates', precipDates);
  
  ////////////////////////////////////////////////////////////////////////////////
  // Step 2b: Calculate daily precipitation
  
  // Function to calculate daily precipitation
  function calcDailyPrecip(curdate) {
      var curyear = ee.Date(curdate).get('year');
      var curdoy = ee.Date(curdate).getRelative('day', 'year').add(1);
      var totprec = gpmFiltered.select('precipitationCal')
                  .filterDate(ee.Date(curdate), ee.Date(curdate).advance(1, 'day'))
                  .sum()
                  //every half-hour
                  .multiply(0.5)
                  .rename('totprec');
      return totprec
          .set('doy', curdoy)
          .set('year', curyear)
          .set('system:time_start', curdate);
  }
  // Map function over list of dates
  var dailyPrecipExtended = ee.ImageCollection.fromImages(precipDates.map(calcDailyPrecip));
  //print('daily precip ext', dailyPrecipExtended);
  
  // Filter back to original user requested start date
  dailyPrecip = dailyPrecipExtended.filterDate(reqStartDate, precipEndDate.advance(1, 'day'));
  //print('daily precip', dailyPrecip.size());


  ////////////////////////////////////////////////////////////////////////////////
  // Step 2c: Summarize daily precipitation by woreda

  // Filter precip data for zonal summaries
  var precipSummary = dailyPrecip.filterDate(reqStartDate, reqEndDate.advance(1, 'day'));
  // Function to calculate zonal statistics for precipitation by woreda
  function sumZonalPrecip(image) { 
    // To get the doy and year, we convert the metadata to grids and then summarize
    var image2 = image.addBands([image.metadata('doy').int(), image.metadata('year').int()]);
    // Reduce by regions to get zonal means for each county
    var output = image2.select(['year', 'doy', 'totprec'], ['year', 'doy', 'totprec'])
                       //.resample('bilinear')
                       .reduceRegions({
                         collection: woreda,
                         reducer: ee.Reducer.mean(),
                         scale: 1000});
    return output;
  }
  // Map the zonal statistics function over the filtered precip data
  var precipWoreda = precipSummary.map(sumZonalPrecip);         
  // Flatten the results for export
  precipFlat = precipWoreda.flatten();
  //print('precip flat', precipFlat);


  ////////////////////////////////////////////////////////////////////////////////
  // Step 3: LST

  ////////////////////////////////////////////////////////////////////////////////
  // Step 3a: Calculate LST variables

  // Filter Terra LST by altered LST start date
  // Rarely, but at the end of the year if the last image is late in the year
  //  with only a few days in its period, it will sometimes not grab the next image appropriately.
  //  Added extra padding to reqEndDate, will be trimmed at the end
  var lstFiltered = lstTerra8
    .filterDate(lstStartDate, reqEndDate.advance(8, 'day'))
    .filterBounds(woreda)
    .select('LST_Day_1km', 'QC_Day', 'LST_Night_1km', 'QC_Night');
  //print('LST filtered', lstFiltered);
  
  // Filter Terra LST by QA information
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
  //print(lstFilteredQA);
  
  // Rescale temperature data and convert to degrees C
  function rescaleLst(image) {
    var lst_day = image.select('LST_Day_1km').multiply(0.02).subtract(273.15).rename('lst_day');
    var lst_night = image.select('LST_Night_1km').multiply(0.02).subtract(273.15).rename('lst_night');
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
  //print('lstVars', lstVars);
  
  // Create list of dates for time series
  var lstRange = lstVars.reduceColumns(ee.Reducer.max(), ["system:time_start"]);
  var lstEndDate = ee.Date(lstRange.get('max')).advance(7, 'day');
  var lstDays = lstEndDate.difference(lstStartDate, 'day');
  var lstDatesPrep = ee.List.sequence(0, lstDays, 1);
  function makeLstDates(n) {
    return lstStartDate.advance(n, 'day');
  }
  var lstDates = lstDatesPrep.map(makeLstDates);
  //print('lstDates', lstDates);

  ////////////////////////////////////////////////////////////////////////////////
  // Step 3b: Calculate daily LST

  // Function to calculate daily LST by assigning the 8-day composite summary to each day 
  // in the composite period
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
  // Map the function over the image collection
  var dailyLstExtended = ee.ImageCollection.fromImages(lstDates.map(calcDailyLst));
  //print('daily LST extended', dailyLstExtended);
  
  // Filter back to original user requested start date
  dailyLst = dailyLstExtended.filterDate(reqStartDate, lstEndDate.advance(1, 'day'));
  //print('daily LST', dailyLst);

  ////////////////////////////////////////////////////////////////////////////////
  // Step 3c: Summarize daily LST by woreda

  // Filter lst data for zonal summaries
  var lstSummary = dailyLst.filterDate(reqStartDate, reqEndDate.advance(1, 'day'));
  // Function to calculate zonal statistics for lst by woreda
  function sumZonalLst(image) { 
    // To get the doy and year, we convert the metadata to grids and then summarize
    var image2 = image.addBands([image.metadata('doy').int(), image.metadata('year').int()]);
    // Reduce by regions to get zonal means for each county
    var output = image2.select(['doy', 'year', 'lst_day', 'lst_night', "lst_mean"], ['doy', 'year', 'lst_day', 'lst_night', 'lst_mean'])
                       .reduceRegions({
                         collection: woreda,
                         reducer: ee.Reducer.mean(),
                         scale: 1000});
    return output;
  }
  // Map the zonal statistics function over the filtered lst data
  var lstWoreda = lstSummary.map(sumZonalLst);  
  // Flatten the results for export
  lstFlat = lstWoreda.flatten();
  //print('lst flat', lstFlat);


  ////////////////////////////////////////////////////////////////////////////////
  // Step 4: BRDF / Spectral Indices

  ////////////////////////////////////////////////////////////////////////////////
  // Step 4a: Calculate spectral indices

  // Filter BRDF-Adjusted Reflectance by Date
  var brdfReflectVars = brdfReflect
    .filterDate(brdfStartDate, reqEndDate.advance(1, 'day'))
    .filterBounds(woreda)
    .select(['Nadir_Reflectance_Band1','Nadir_Reflectance_Band2','Nadir_Reflectance_Band3',
            'Nadir_Reflectance_Band4','Nadir_Reflectance_Band5','Nadir_Reflectance_Band6',
            'Nadir_Reflectance_Band7'],
            ['red', 'nir', 'blue', 'green', 'swir1', 'swir2', 'swir3']);
  
  // Filter BRDF QA by Date
  var brdfReflectQA = brdfQA
    .filterDate(brdfStartDate, reqEndDate.advance(1, 'day'))
    .filterBounds(woreda)
    .select(['BRDF_Albedo_Band_Quality_Band1', 'BRDF_Albedo_Band_Quality_Band2', 'BRDF_Albedo_Band_Quality_Band3',
            'BRDF_Albedo_Band_Quality_Band4', 'BRDF_Albedo_Band_Quality_Band5', 'BRDF_Albedo_Band_Quality_Band6',
            'BRDF_Albedo_Band_Quality_Band7', 'BRDF_Albedo_LandWaterType'],
            ['qa1', 'qa2', 'qa3', 'qa4', 'qa5', 'qa6', 'qa7', 'water']);
  
  // Join the 2 collections
  var idJoin = ee.Filter.equals({leftField: 'system:time_end', rightField: 'system:time_end'});
  // Define the join
  var innerJoin = ee.Join.inner('NBAR', 'QA');
  // Apply the join
  var brdfJoined = innerJoin.apply(brdfReflectVars, brdfReflectQA, idJoin);
  //print('brdf joined', brdfJoined);
  
  // Add QA bands to the NBAR collection
  function addQABands(image){
      var nbar = ee.Image(image.get('NBAR'));
      var qa = ee.Image(image.get('QA')).select(['qa2']);
      var water = ee.Image(image.get('QA')).select(['water']);
      return nbar.addBands([qa, water]);
  }
  var brdfMerged = ee.ImageCollection(brdfJoined.map(addQABands));
  //print('brdf merged', brdfMerged);
  
  // Function to mask out pixels based on qa and water/land flags 
  function filterBrdf(image) {
    var qaband = image.select(['qa2']); // Right now, only using QA info for the NIR band
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
  //print('brdf filtered vars', brdfFilteredVars);
  
  // Function to calculate spectral indices
  function calcBrdfIndices(image) {
    var curyear = ee.Date(image.get("system:time_start")).get('year');
    var curdoy = ee.Date(image.get("system:time_start")).getRelative('day', 'year').add(1);
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
  // Map function over image collection
  brdfFilteredVars = brdfFilteredVars.map(calcBrdfIndices);
  //print('brdf filt vars', brdfFilteredVars);
 
  // Create list of dates for time series
  var brdfRange = brdfFilteredVars.reduceColumns(ee.Reducer.max(), ["system:time_start"]);
  var brdfEndDate = ee.Date(brdfRange.get('max'));
  var brdfDays = brdfEndDate.difference(brdfStartDate, 'day');
  var brdfDatesPrep = ee.List.sequence(0, brdfDays, 1);
  function makeBrdfDates(n) {
    return brdfStartDate.advance(n, 'day');
  }
  var brdfDates = brdfDatesPrep.map(makeBrdfDates);
  //print('brdf dates', brdfDates);


  ////////////////////////////////////////////////////////////////////////////////
  // Step 4b: Calculate daily spectral indices
  
  function calcDailyBrdf(curdate) {
      var curyear = ee.Date(curdate).get('year');
      var curdoy = ee.Date(curdate).getRelative('day', 'year').add(1);
      var brdfTemp = brdfFilteredVars.filterDate(ee.Date(curdate), ee.Date(curdate).advance(1, 'day'));
      var brdfSize = brdfTemp.size();
      var outimg = ee.Image(ee.Algorithms.If(brdfSize.eq(0),
                                               ee.Image.constant(0).selfMask()
                                                 .addBands(ee.Image.constant(0).selfMask())
                                                 .addBands(ee.Image.constant(0).selfMask())
                                                 .addBands(ee.Image.constant(0).selfMask())
                                                 .addBands(ee.Image.constant(0).selfMask())
                                                 .rename(['ndvi', 'evi', 'savi', 'ndwi5', 'ndwi6'])
                                                 .set('doy', curdoy)
                                                 .set('year', curyear)
                                                 .set('system:time_start', curdate),
                                               brdfTemp.first()));
      return outimg;
  }
  // Map the function over the image collection
  var dailyBrdfExtended = ee.ImageCollection.fromImages(brdfDates.map(calcDailyBrdf));
  //print('daily brdf extended ', dailyBrdfExtended);
  var properties = dailyBrdfExtended.propertyNames();
  //print('Metadata properties: ', properties);
  // Filter back to original user requested start date
  dailyBrdf = dailyBrdfExtended.filterDate(reqStartDate, brdfEndDate.advance(1, 'day'));
  //print('daily brdf ', dailyBrdf);


  ////////////////////////////////////////////////////////////////////////////////
  // Step 4c: Summarize daily spectral indices by woreda

  // Filter spectral indices for zonal summaries
  var brdfSummary = dailyBrdf.filterDate(reqStartDate, reqEndDate.advance(1, 'day'));
  //print(brdfSummary,'brdfSummary')
  // Function to calculate zonal statistics for spectral indices by county
  function sumZonalBrdf(image) { 
    // To get the doy and year, we convert the metadata to grids and then summarize
    var image2 = image.addBands([image.metadata('doy').int(), image.metadata('year').int()]);
    // Reduce by regions to get zonal means for each county
    var output = image2.select(['doy', 'year', 'ndvi', 'savi', 'evi', 'ndwi5', 'ndwi6'], ['doy', 'year', 'ndvi', 'savi', 'evi', 'ndwi5', 'ndwi6'])
                       .reduceRegions({
                         collection: woreda,
                         reducer: ee.Reducer.mean(),
                         scale: 1000});
    return output;
  }
  // Map the zonal statistics function over the filtered spectral index data
  var brdfWoreda = brdfSummary.map(sumZonalBrdf); 
  //print('brdfworeda', brdfWoreda);

  // Flatten the results for export
  brdfFlat = brdfWoreda.flatten();
  //print('brdf flat', brdfFlat);


  ////////////////////////////////////////////////////////////////////////////////
  // Step 5: Exporting Set-up

  //Export naming
  //Precip
  var precipPrefix = "Export_Precip_Data";
  var precipLastDate = ee.Date(ee.Algorithms.If(
    reqEndDate.difference(precipEndDate, 'day').gt(0),
    precipEndDate,
    reqEndDate
  ));
  var precipSummaryEndDate = precipLastDate.format('yyyy-MM-dd').getInfo();
  precipFilename = precipPrefix.concat("_", userStartDate, "_", precipSummaryEndDate);
  //LST
  var lstPrefix = "Export_LST_Data";
  var lstLastDate = ee.Date(ee.Algorithms.If(
    reqEndDate.difference(lstEndDate, 'day').gt(0),
    lstEndDate,
    reqEndDate
  ));
  var lstSummaryEndDate = lstLastDate.format('yyyy-MM-dd').getInfo();
  lstFilename = lstPrefix.concat("_", userStartDate, "_", lstSummaryEndDate);  
  //BRDF
  var brdfPrefix = "Export_Spectral_Data";
  var brdfLastDate = ee.Date(ee.Algorithms.If(
    reqEndDate.difference(brdfEndDate, 'day').gt(0),
    brdfEndDate,
    reqEndDate
  ));
  var brdfSummaryEndDate = brdfLastDate.format('yyyy-MM-dd').getInfo();
  brdfFilename = brdfPrefix.concat("_", userStartDate, "_", brdfSummaryEndDate);



} //end calculateEnvVars




////////////////////////////////////////////////////////////////////////////////
//
// Function for exporting
//

// for when run in Code Editor with access to Tasks
// can be used for longer time periods, when app would have limited it to 2 months
function exportToDrive(){
  
  // Drive Exports (will only be visible when running from code editor)
  // Export flattened tables to Google Drive
  // Need to click "RUN in the Tasks tab to configure and start each export
  Export.table.toDrive({
    collection: precipFlat,
    description: precipFilename,
    selectors: ['NewPCODE', 'R_NAME','W_NAME','Z_NAME', 'doy', 'year', 'totprec']
  });
  Export.table.toDrive({
    collection: lstFlat, 
    description: lstFilename,
    selectors: ['NewPCODE', 'R_NAME','W_NAME','Z_NAME', 'doy', 'year', 'lst_day', 'lst_night', 'lst_mean']
  });
  Export.table.toDrive({
    collection: brdfFlat, 
    description: brdfFilename,
    selectors: ['NewPCODE', 'R_NAME','W_NAME','Z_NAME', 'doy', 'year', 'ndvi', 'savi', 'evi', 'ndwi5', 'ndwi6']
  });

}

// Separate function for final exporting in app, new UI panel, etc.
function exportSummaries(){

  // Create download URLs to display
  //getdownloadurl
  var precipURL = precipFlat.getDownloadURL({format: 'csv',
                    filename: precipFilename,
                    selectors: ['NewPCODE', 'R_NAME','W_NAME','Z_NAME', 'doy', 'year', 'totprec']
  });
  var lstURL = lstFlat.getDownloadURL({format: 'csv',
                      filename: lstFilename,
                      selectors: ['NewPCODE', 'R_NAME','W_NAME','Z_NAME', 'doy', 'year', 'lst_day', 'lst_night', 'lst_mean'],
  });
  var brdfURL = brdfFlat.getDownloadURL({format: 'csv',
                      filename: brdfFilename,
                      selectors: ['NewPCODE', 'R_NAME','W_NAME','Z_NAME', 'doy', 'year', 'ndvi', 'savi', 'evi', 'ndwi5', 'ndwi6'],
  });

  
  // print(precipURL);
  // print(lstURL);
  // print(brdfURL);
  
  // Add download links to UI
  // Borrow/adapted from TC Chakraborty Global Surface UHI Explorer
  // Link construction
  var linkSection = ui.Chart(
    [
      ['Download data'],
      ['<a target = "_blank" href = '+precipURL+'>' + 
      'Precipitation</a>'],
      ['<a target = "_blank" href = '+lstURL+'>' + 
      'Land Surface Temperatures</a>'],
      ['<a target = "_blank" href = '+brdfURL+'>' + 
      'Spectral Indicies</a>'],
    ],
    'Table', {allowHtml: true});
    // Make link panel
    downloadPanel = ui.Panel([linkSection], ui.Panel.Layout.Flow('vertical'));
    sidePanel.add(downloadPanel);
}



////////////////////////////////////////////////////////////////////////////////
//
// UI 
//

//UI-related variables
var map = ui.Map();
var sidePanel = ui.Panel();
var resultsPanel = ui.Panel();
var downloadPanel = ui.Panel();

var now = Date.now(); //used in UI default dates

var config = {
  //28 days before today
  initialStartDate: ee.Date(now).advance(-28, 'days').format('YYYY-MM-dd').getInfo(),
  //today
  initialEndDate: ee.Date(now).format('YYYY-MM-dd').getInfo(),
  initialCalcButtonText: 'Click to summarize (will take several seconds, please be patient)',
};

// Palettes for environmental variable maps
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
  
  var panel = ui.Panel();

  // start date box
  var startDateLabel = ui.Label({
    value: 'Start Date for Summary (YYYY-MM-DD):',
    //style: {fontWeight: 'bold'}
  });
  panel.add(startDateLabel);
  var startDateInput = ui.Textbox({
    value: config.initialStartDate,
    onChange: function(value) {
      //reset calc button
      calcButton.setLabel(config.initialCalcButtonText);
      //reset results/summaries
      panel.remove(resultsPanel);
      sidePanel.remove(downloadPanel);
      resetResults();
      //reset map
      map.clear();
      drawBaseMap();
      //set value
      startDateInput.setValue(value);
      return(value);
    }
  });
  panel.add(startDateInput);

  // end date box
  var endDateLabel = ui.Label({
    value: 'End Date for Summary (YYYY-MM-DD):',
    //style: {fontWeight: 'bold'}
  });
  panel.add(endDateLabel);
  var endDateInput = ui.Textbox({
    value: config.initialEndDate,
      onChange: function(value) {
      //reset calc button
      calcButton.setLabel(config.initialCalcButtonText);
      //reset results/summary
      panel.remove(resultsPanel);
      sidePanel.remove(downloadPanel);
      resetResults();
      //reset map
      map.clear();
      drawBaseMap();
      //set value
      endDateInput.setValue(value);
      return(value);

    }
  });
  panel.add(endDateInput);
  
  // calculate button
  var calcButtonLabel = ui.Label({
    value: '2. Calculate environmental variables for selected dates:',
    style: {fontWeight: 'bold'}
  });
  panel.add(calcButtonLabel);
  var calcButton = ui.Button({
    label: config.initialCalcButtonText,
    onClick: function(button) {
      button.setLabel('(Current)');
      //call main calc script with user set dates
      calculateEnvVars(startDateInput.getValue(), endDateInput.getValue());
      //create new results panel & add
      resultsPanel = createResultsPanel(startDateInput.getValue(), endDateInput.getValue());
      panel.add(resultsPanel);
      //add tasks for Drive Export
      exportToDrive();
    }
  });
  panel.add(calcButton);
  

  return panel;
  
}


function drawEnvMap(dtRange){
  //from slider, a date range to show of the env variables

  // Filter image collections based on slider value
  var brdfDisp = dailyBrdf.filterDate(dtRange.start(), dtRange.end());
  print(dailyBrdf,'dailybrdfin env')
  var lstDisp = dailyLst.filterDate(dtRange.start(), dtRange.end());
  var precipDisp = dailyPrecip.filterDate(dtRange.start(), dtRange.end());
  
  // Select the image (should be only one) from each collection
  var precipImage = precipDisp.first().select('totprec');
  var lstdImage = lstDisp.first().select('lst_day');
  var lstmImage = lstDisp.first().select('lst_mean');
  var ndviImage = brdfDisp.first().select('ndvi');
  var ndwi6Image = brdfDisp.first().select('ndwi6');

  //reset map
  map.clear();
  drawBaseMap();

  // Add layers to the map viewer
  //show precipitation by default, others hidden until users picks them from layers drop down
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

function createResultsPanel(userStartDate, userEndDate){
    
    //date slider for displaying env data on map
    var dateLabel = ui.Label({value: 'Optional: Pick a date to show environmental data on the map. ' +
              'Choose layers from the layer menu in the upper right of map. ' + 
              'Some layers may not yet be available close to the current date.'});
    var dateDisplay = ui.DateSlider({
    start: userStartDate,
    end: ee.Date(userEndDate).advance(1, 'day').format('YYYY-MM-dd').getInfo(),
    value: userStartDate,
    onChange: function(value){
      //value is a DateRange 
      //draw map
      drawEnvMap(value);
      }
    });
    //wrap in a panel to group label and slider
    var pickDateDisplay = ui.Panel([
      dateLabel,
      dateDisplay
    ]);

  var dayCount = ee.Date(userEndDate)
                .difference(ee.Date(userStartDate), 'days')
                .add(1);

  var dayLabel = ui.Label('Number of days selected: ' + dayCount.getInfo());

  // download button
  var downloadButton = ui.Button({
    label:"3. Get download links for woreda summary CSV files",
    onClick: function(button) {
      //create links and show
      //creates Tasks (for when in code editor)
      exportSummaries();
    }
  });
  
  //Previously only show download button if under 65 days (~2 mo)
  //print(dayCount.lte(65));
  //print(Boolean(dayCount.lte(65)));
  //print(dayCount.lte(65).getInfo());
  //print(Boolean(dayCount.lte(65).getInfo()));
  
  //show up to ~9 mo as hard limit
  downloadButton.style().set('shown', Boolean(dayCount.lte(280).getInfo()));

  var resultsUI = ui.Panel([pickDateDisplay,
                            dayLabel,
                            downloadButton]);
  return resultsUI;
}


function drawBaseMap(){
  
  //Display the outline of woredas as a black line, no fill
  // Create an empty image into which to paint the features, cast to byte.
  var empty = ee.Image().byte();
  // Paint all the polygon edges with the same number and width, display.
  var outline = empty.paint({
    featureCollection: woreda,
    color: 1,
    width: 1
  });
  map.addLayer(outline, {palette: '000000'}, 'Woredas');

}


function init() {
  
  //default map
  map.setCenter(40.5, 9.5, 6);
  drawBaseMap();
  
  sidePanel = makeSidePanel(
    'Retrieving Environmental Analytics for Climate and Health (REACH)',
    'Generates daily environmental data summarized by woreda, ' +
      'for use in the EPIDEMIA system for forecasting malaria. ' +
      'Version 3.2-ETH.'
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
    'https://code.earthengine.google.com/3ce033810d24ca764b5c1ef393889f21');
  var moreInfoPanel = ui.Panel({
    widgets: [//ui.Label('', {}), 
              //packageLink, 
              websiteLink,
              codeLink],
    style: {padding: '0px 0px 0px 10px'}}
    );
  sidePanel.add(moreInfoPanel);


    
  var descriptionText = 
  '1. Enter a date range to download data. Please request only a few months at one time, otherwise it may time out.';
  
  sidePanel.add(ui.Label({value: descriptionText,
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

