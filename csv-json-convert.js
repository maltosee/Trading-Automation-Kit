'use strict'; 
// require csvtojson module
const CSVToJSON = require('csvtojson');
const fs = require('fs');

// convert users.csv file to JSON array
CSVToJSON().fromFile('zones.csv')
    .then(zones => {

        // users is a JSON array
        // log the JSON array
        console.log(zones);
		try 
		{
			fs.writeFileSync('zones.json', JSON.stringify(zones));
			console.log("JSON data is saved.");
		} catch (error) 
		{
			console.error(err);
		}
    console.log("JSON array is saved.");
		
		
    }).catch(err => {
        // log error if any
        console.log(err);
    });