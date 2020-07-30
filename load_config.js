"use strict";

const fs = require('fs');

module.exports= load_config;

// Create promise and SNS service object
function load_config(config_file)
{
	var self = this;
	//self.params=params;
	var constants;
	//var const_fields=[];
	
	
	let rawdata = fs.readFileSync(config_file);
	let config_data = JSON.parse(rawdata);
	return config_data;
	
	
}

