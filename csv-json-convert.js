'use strict'; 
// require csvtojson module
const CSVToJSON = require('csvtojson');
const fs = require('fs');

let input= process.argv[2];
let output= input.split(".");
let output_file= output[0]+".json";

// convert users.csv file to JSON array
CSVToJSON().fromFile(input)
    .then(zones => {

        // users is a JSON array
        // log the JSON array
        console.log(zones);
		try 
		{
			fs.writeFileSync(output_file, JSON.stringify(zones));
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