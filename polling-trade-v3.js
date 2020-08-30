'use strict'; 
//var lockFile1 = require("lockfile");
var KiteConnect = require("kiteconnect").KiteConnect;
//var KiteTicker = require("kiteconnect").KiteTicker;
var SimpleNodeLogger = require('simple-node-logger');
//var abs = require('math-abs');
//var config_entries=[[738561,100,100,100], [779521,100,100,100]]; //array of 
//vr obj = csv(); 
//const csvdata = require('csvdata');
const fs = require('fs');
var dateFormat = require('dateformat');
var mysql = require('mysql2/promise');

const { parse } = require('json2csv');
 
const fields = ['date', 'open', 'high','low','close','volume','symbol'];
const opts = { fields };
//console.log('before variable declaration');

var api_key = "bejtlvvs8bo43qxb",
	secret = "2c3yebbn666rqiea3qcgth4kvqgnkv7p",
	request_token = "yX6KgNyAHiPladY95EYGabifWKq5EVLB",
	access_token = "";
	
const order_type ="regular";
	
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

//console.log('DEBUG: before logging info on lock');
//log.info('Started -- Checking for lock');
//console.log('DEBUG: after logging info on lock');
/**if (lockFile1.checkSync('some-file.lock')) 
{
	  
	  console.log('DEBUG: exiting due to lock');
	  log.info('Still locked -- exiting');
	  //process.exit(0);
	  
}**/


var err_arr=[];

		//log.info('Going to execute main logic');
	main_logic().then
	(
		function(resp) 
		{
			log.info('Back to main loop after main logic with no uncaught exceptions- ',resp);
			log.error('Errors for - ',err_arr);
		}
	).catch(function(err) {log.error('uncaught error in main logic ',err)});
		
			
		
		//fifteensectimer();
	

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

			/**let connection = await mysql.createConnection({
				host: 'mysql-01.coqgcxnvqjeu.us-east-1.rds.amazonaws.com', // host for connection
				port: 3306, // default port for mysql is 3306
				database:'FNOTRADING',//db
				user: 'admin', // username of the mysql connection
				password: 'fsnot2020' // password of the mysql connection
				}); **/
			
			//log.info('Connected to DB');
		
			let sql =`SELECT * FROM ZONES B `;
		
			//let [instruments,fields]= await connection.execute(sql);
			
						
			//var instruments = JSON.parse(fs.readFileSync('instruments.json'));
			//log.info('Instruments are - ',instruments);
			//var resp_ltp;
			
			
			//log.info('before creating kiteconnect object in main logic');

			var kc = new KiteConnect(options);
			kc.setSessionExpiryHook(sessionHook);

			if(!access_token) {
				//console.log("before generateSession");
				log.info("Before session generation");
				
				var response = await kc.generateSession(request_token, secret);
				log.info('Access token metadat - ', response);
				
			}
			else {
				kc.setAccessToken(access_token);
				//init();
			}
				 				
				//log.error('Error occurred in main_logic while calling generateSession - ',err);
					//log.info('Returning to main loop');
				
						
				log.info('Instruments length -',instruments.length);
				var i;
				
				let start_date="2020-02-13 09:15:00";
				let end_date="2020-02-13 15:30:00";
				
				var stream = fs.createWriteStream(start_date.substr(0,10)+"-"+end_date.substr(0,10)+".csv", {flags:'a'});
				
				for(i=0; i<instruments.length; i++)
				{
						
					try
					{
							//let x= instruments[i]['EXCHANGE']+":"+instruments[i]['SYMBOL'];
							let x= 'NSE:'+instruments[i]['symbol'];
							log.info('before getting historic data .Iteration - ',i.toString(),' - symbol ',x);
							
							//let flag=instruments[i]['INTRA DAY'];
							
							//if (flag =="Y") 
							/**{**/
							
							let p = await kc.getHistoricalData(instruments[i]['token'], "5minute", start_date, end_date);
								
							
							log.info('Writing for -',instruments[i]['symbol']);
							//console.log(p);
							
							
							
							let temp=0, temp_arr=[];
							
							for(temp=0;temp<p.length;temp++)
							{
							  // csv[temp].concat(instruments[i]['symbol']+',');	
							   //log.info(csv[temp]);
							   p[temp]['symbol']=instruments[i]['symbol'];
							}
							//log.info(JSON.stringify(p));
							
							let csv = parse(p, opts);
					
							//let saved = fs.writeFileSync(instruments[i]['symbol']+'-'+start_date.substr(0,10)+".json",JSON.stringify(p),'utf8');
							//let saved = fs.appendFileSync(instruments[i]['symbol']+'-'+start_date.substr(0,10)+".csv",csv,'utf8');
							//fs.appendFileSync(start_date.trim()+"-"+end_date.trim()+".csv,csv,'utf8');
							stream.write(csv+"\n");

					}
					catch(err)
					{
						log.error('Failure for instrument - ',instruments[i]['symbol'],'-',err);
						err_arr.push(instruments[i]['symbol']);
					}
					
						/**}**/						
						
				}
				
					
									
	}
	catch(err)
	{
		log.error('Error occurred in main_logic - ',err);
	}
	finally
	{
		stream.end();
	}
		
		
}

function sessionHook() {
	log.info("User loggedout");
}

/**async function getHistoricalData(instrument_token, interval, from_date, to_date, continuous) {
	kc.getHistoricalData(instrument_token, interval, from_date, to_date, continuous)
		.then(function(response) {
			console.log(response);
		}).catch(function(err) {
			console.log(err);
		});**/

/**async function getLTP(instruments) {
	kc.getLTP(instruments).then(function(response) {
		log.info(response);
	}).catch(function(err) {
		log.error(err);
	})
}**/
