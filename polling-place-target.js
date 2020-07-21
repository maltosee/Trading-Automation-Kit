'use strict';
var KiteConnect = require("kiteconnect").KiteConnect;
var KiteTicker = require("kiteconnect").KiteTicker;
var SimpleNodeLogger = require('simple-node-logger');
var abs = require( 'math-abs' );
var dateFormat = require('dateformat');
//var config_entries=[[738561,100,100,100], [779521,100,100,100]]; //array of 
//vr obj = csv(); 
//const csvdata = require('csvdata');
//const fs = require('fs');
var mysql = require('mysql2/promise');


//const orders_placed=[];
//var lockFile1 = require("lockfile");
//const lockfile="some-file.lock";
var tokenMap = {};

//const bucket_id=process.argv[2];
var connection;

var api_key = "bejtlvvs8bo43qxb",
	secret = "2c3yebbn666rqiea3qcgth4kvqgnkv7p",
	request_token = "eifpKNorsQQuxuEpu6PjKhqzRKKrWmYf",
	access_token = "";
	
var options = {
	"api_key": api_key,
	"debug": false
};

let date_string = "Target-Order-"+dateFormat(new Date(), "yyyymmddhhmmss")+".log";
const curr_date=dateFormat(new Date(), "yyyymmdd");
console.log('log file path - ',date_string);

var log_opts = {
        logFilePath:date_string,
        timestampFormat:'YYYY-MM-DD HH:mm:ss.SSS'
    };
	
var log = SimpleNodeLogger.createSimpleLogger( log_opts );


var csv_loaded=[], instruments=[], items=[];

var kc = new KiteConnect(options);
//kc.setSessionExpiryHook(sessionHook);


if(!access_token) {
	//console.log("before generateSession");
	log.info("Before session generation");
	kc.generateSession(request_token, secret)
		.then(function(response) {
			console.log("Response", response);
			//init();
		})
		.catch(function(err) {
			log.error("Error in session generation",err);
			console.log(err);
			
			
		})
} else {
	kc.setAccessToken(access_token);
	//init();
}

var ticker = new KiteTicker({
	api_key: api_key,
	access_token: access_token
});

main_logic().then
(
		function(resp) 
		{
			log.info('Back to main loop after main logic with no uncaught exceptions- ',resp);
		}
).catch(
	function(err) 
	{
		log.error('uncaught error in main logic ',err);
	}
);

async function main_logic()
{
	try
	{	
		connection = await mysql.createConnection({
		host: 'mysql-01.coqgcxnvqjeu.us-east-1.rds.amazonaws.com', // host for connection
		port: 3306, // default port for mysql is 3306
		database:'FNOTRADING',//db
		user: 'admin', // username of the mysql connection
		password: 'fsnot2020' // password of the mysql connection
		});
		
		log.info('Connected to DB');
				
	
	
		let positions= await kc.getPositions();
	    let results=positions['net'];
		
		
		for (let i=0; i<results.length; i++)
		{
							 
		  try
		  {
		  
				let [instruments,fields]= await conn.execute(sql,[results[i]['tradingsymbol']]);
						 
				if(instruments.length<0)
				{ 
					throw('No target config found for trade instrument ',results[i]['tradingsymbol']);
				}
				
				let x ='NSE'+":"+instruments[0]['SYMBOL'];
						
				let resp_ltp = await kc.getLTP(x);
				//log.info('LTP of  - '+instruments[0]['SYMBOL'] -' ,resp_ltp[x]);
						
				let price_diff=abs(resp_ltp[x]['last_price']-instruments[0]['TARGET'])/resp_ltp[x]['last_price'];
				
				let type='';
						
				if(price_diff<=0.004) //0.4%
				{
					
						 
						if(results[i]['quantity'] <0)
						{
							type="BUY";
						}
						else
						{
							type="SELL";
						}
						 
						 
						 params.LOT=-1*results[i]['quantity'];
						 params.TAG='API';
						 params.ENTRY=instruments[j]['ENTRY'];
						 params.STOP_LOSS=instruments[j]['STOP_LOSS'];
						 params.TARGET=instruments[j]['TARGET'];
						 
						/** let order_resp = await kc.placeOrder("regular", {
															"exchange": "NSE",
															"tradingsymbol": results[i]['tradingsymbol'],
															"transaction_type": type,
															"quantity": -1*results[i]['quantity'],
															"product": "NRML",
															"order_type": "MARKET",
															"tag":"API"
														});**/
						 
						if (order_resp.status!='success')
						{
							throw('Critical error in placing target order for - ' +results[i]['tradingsymbol']);
						}
					
				 }
		      }
			  catch(err)
			  {
				 log.error(err);  
			  }
		   }

	}
	catch(err)
	{
	  log.error(err);	  
	}
	finally
	{
		log.info('Closing connection');
	}
					
	
}

function sessionHook() {
	log.info("User loggedout");
}