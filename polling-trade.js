'use strict'; 
var lockFile1 = require("lockfile");
var KiteConnect = require("kiteconnect").KiteConnect;
var KiteTicker = require("kiteconnect").KiteTicker;
var SimpleNodeLogger = require('simple-node-logger');
var abs = require('math-abs');
//var config_entries=[[738561,100,100,100], [779521,100,100,100]]; //array of 
//vr obj = csv(); 
//const csvdata = require('csvdata');
const fs = require('fs');
var dateFormat = require('dateformat');

//console.log('before variable declaration');

var api_key = "chwh6abfx02v61id",
	secret = "mmqmv4meadot1lzypq5son13kqk0cbgd",
	request_token = "1ogGBo2ngX2TCut95mbuOiFVDcf6uJLp",
	access_token = "vBk4dbGbat4qS73Z8bIfcqsh2fpJDAaC";
	
var options = {
	"api_key": api_key,
	"debug": false
};

//const logfile = new Date().toISOString()+".log";
let date_string = dateFormat(new Date(), "yyyymmddhhmmss")+".log";
console.log('log file path - ',date_string);

var log_opts = {
        logFilePath:date_string,
        timestampFormat:'YYYY-MM-DD HH:mm:ss.SSS'
    };
//console.log('Before instantiating log variable ', logfile);
var log = SimpleNodeLogger.createSimpleLogger( log_opts );
//console.log('After Instantiating log variable');

console.log('DEBUG: before logging info on lock');
log.info('Started -- Checking for lock');
//console.log('DEBUG: after logging info on lock');
if (lockFile1.checkSync('some-file.lock')) 
{
	  
	  console.log('DEBUG: exiting due to lock');
	  log.info('Still locked -- exiting');
	  //process.exit(0);
	  
}
else
{
	//console.log('no lock');
	log.info('no lock');

	lockFile1.lockSync('some-file.lock');
	log.info('In main loop before calling main logic -- Just locked');



		//log.info('Going to execute main logic');
			main_logic().then
			(
				function(resp) 
				{
					log.info('Back to main loop after main logic with no uncaught exceptions- ',resp);
				}
			).catch(function(err) {log.error('uncaught error in main logic ',err)});
				
			
		
		//fifteensectimer();
	
}

async function fifteensectimer()
{
	await setTimeout(function () {
				log.info('In Set time out')
				}, 15000);
}

async function main_logic()
{
		 
	try
	{

			
			
						
			var instruments = JSON.parse(fs.readFileSync('instruments.json'));
			log.info('Instruments are - ',instruments);
			//var resp_ltp;
			
			
			//log.info('before creating kiteconnect object in main logic');

			var kc = new KiteConnect(options);
			kc.setSessionExpiryHook(sessionHook);

			if(!access_token) {
				//console.log("before generateSession");
				log.info("Before session generation");
				
				await kc.generateSession(request_token, secret);
				
			}
			else {
				kc.setAccessToken(access_token);
				//init();
			}
				 				
				//log.error('Error occurred in main_logic while calling generateSession - ',err);
					//log.info('Returning to main loop');
					
						
				log.info('Instruments length -',instruments.length);
				var i;
				
				for(i=0; i<instruments.length; i++)
				{
						let x= instruments[i]['EXCHANGE']+":"+instruments[i]['SYMBOL'];
						log.info('Iteration - ',i.toString(),' - symbol ',x);
						let resp_ltp = await kc.getLTP(x);
						log.info('In main logic - ',resp_ltp);
						log.info('LTP - ' ,resp_ltp[x]['last_price']);
						
						let price_diff=abs(resp_ltp[x]['last_price']-instruments[i]['ENTRY']);
						
						if(price_diff<=0.015) //1.5%
						{
							log.info('lacing order for ',instruments[i]['SYMBOL']);
							await kc.placeOrder("regular", {
								"exchange": instruments[i]['EXCHANGE'],
								"tradingsymbol": instruments[i]['SYMBOL'],
								"transaction_type": instruments[i]['TYPE'],
								"quantity": instruments[i]['LOT'],
								"product": "NRML",
								"price": instruments[i]['ENTRY'],
								"order_type": "LIMIT",
								"tag":"API"
							});
						}
												
						
				}
				/**kc.generateSession(request_token, secret)
					.then(function(response) {
						console.log("Response", response);
						init();
					})
					.catch(function(err) {
						log.error("Error in session generation",err);
						console.log(err);
						
					})**/
					
						
			lockFile1.unlockSync('some-file.lock');
			log.info('In main logic -- Just unlocked');
			
	}
	catch(err)
	{
		log.error('Error occurred in main_logic - ',err);
		/**if (lockFile1.checkSync('some-file.lock')) 
		{
			log.info('Unlocking in main logic-');
			lockFile1.unlockSync('some-file.lock');
					  
		}**/
	}
		
		
}

function sessionHook() {
	log.info("User loggedout");
}

async function getLTP(instruments) {
	kc.getLTP(instruments).then(function(response) {
		log.info(response);
	}).catch(function(err) {
		log.error(err);
	})
}