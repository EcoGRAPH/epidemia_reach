## REACH

Our Retrieving Environmental Analytics for Climate and Health (REACH) applications gathers environmental data via Google Earth Engine (GEE). GEE is a cloud-based platform for hosting satellite imagery. GEE also provides tools to process these remote sensing images and other geospatial datasets. Instead of downloading the raw satellite files and processing them on your own computer, which requires significant internet bandwidth and processing power, these steps are done in the cloud. And at the end, we only need to download the summarized output. 

There are three available tools: 

1. A Javascript version to run in the GEE Code Editor in a browser

2. A web-based GEE app at https://dawneko.users.earthengine.app/view/epidemiar-ethiopia-demo

3. A python package with functions that interface with GEE and can optionally be called from an R script 

We use this environmental data to feed into our Epidemic Prognosis Incorporating Disease and Environmental Monitoring for Integrated Assessment (EPIDEMIA) Forecasting System. This is a set of tools coded in free, open-access software, that integrate surveillance and environmental data to model and create short-term forecasts for environmentally-mediated diseases. 

For more information on EPIDEMIA, please see:

EPIDEMIA project: http://ecograph.net/epidemia

epidemiar R package: https://github.com/EcoGRAPH/epidemiar/releases/latest

Demo project: https://github.com/EcoGRAPH/epidemiar-demo/releases/latest



