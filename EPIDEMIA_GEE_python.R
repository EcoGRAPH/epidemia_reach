# #####################################################################
#
# This script can be used to request environmental data from GEE
#   by going through the R package reticulate to a 
#   custom python package, epidemia-gee, and requesting our custom 
#   processed summarized daily data to be downloaded to a Google Drive.
#
# Please see the install instructions for epidemia-gee, including
#   Anaconda and set-up here:
#
#        https://github.com/EcoGRAPH/epidemia-gee/releases/latest
#
#
# The python package is built around a national data set, and 
#   the environmental data cannot to used directly in this project.
# However, it was included to show how this set up works.
#
# #####################################################################

#load packages
if (!require("pacman")) install.packages("pacman")
pacman::p_load(reticulate)

#use the conda environment we set up earlier in Anaconda
reticulate::use_condaenv("gee-demo", conda = "auto", required = TRUE)

#import the Earth Engine library
ee <- reticulate::import("ee")          
#authenticate
ee$Initialize()

#import the epidemia-gee package
eth_gee <- reticulate::import("Ethiopia")  

#Now we have access to the gee_to_drive() function
#   which accepts a start and end date in 'YYYY-MM-DD' format
#   and requests our daily summarized data for that range.
# The three resulting .csv files will be downloaded to an "Ethiopiadata" folder 
#   in the Google Drive of the authenticated account.

#example 1: short time range
# start date of June 1, 2021 & end date of June 30, 2021
eth_gee$Et$gee_to_drive('2021-06-01','2021-06-30')  

#example 2: long time range
# start date of January 1, 2010 & end date of December 31, 2020
eth_gee$Et$gee_to_drive('2010-01-01','2020-12-31') 
