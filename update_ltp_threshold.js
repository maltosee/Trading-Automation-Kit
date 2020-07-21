'use strict';
var KiteConnect = require("kiteconnect").KiteConnect;
var SimpleNodeLogger = require('simple-node-logger');
var abs = require( 'math-abs' );
var dateFormat = require('dateformat');
var mysql = require('mysql2/promise');
var config_items = require('./load_config.js');
const cfg= new config_items('./config.json');

//var pub_sms=require("./send_sms/sns_publishsms.js");


//var msg_send = new pub_sms();

var api_key = "bejtlvvs8bo43qxb",
	secret = "2c3yebbn666rqiea3qcgth4kvqgnkv7p",
	request_token = "NWfNMi2XMGKzGWbmL6w4RZAN7wIDiOG6",
	access_token = "6TwwRZBbD1nr52EAylmTK43CtNFxm5p3";

let moment = require("moment-timezone");

let now = moment();



let date_string = dateFormat(new Date(), "yyyymmddhhmmss")+"-update_LTP_diff.log";
//const curr_date=dateFormat(new Date(), "yyyymmdd");
console.log('log file path - ',date_string);

var log_opts = {
		logFilePath:'logs/'+date_string,
        timestampFormat:'YYYY-MM-DD HH:mm:ss.SSS'
    };
	
var log = SimpleNodeLogger.createSimpleLogger( log_opts );


var instruments=[], items=[], risk_buffer=0;

var options = {
	"api_key": cfg['api_key'],
	"debug": false
};
var connection;


var kc = new KiteConnect(options);
//var ps= new pub_sms();
kc.setAccessToken(cfg['access_token']);

kc.setSessionExpiryHook(sessionHook);


main_logic().then
(
		function(resp) 
		{
			log.info('Back to main loop after main logic with no uncaught exceptions- ',resp);
			
			//process.exit(0);
		}
).catch(
	function(err) 
	{
		log.error('uncaught error in main logic ',err);
		//process.exit(1);
	}
);

async function main_logic()
{
	try
	{
		
		
		//log.info('Started new execution at ' +dateFormat(new Date(), "yyyymmddhhmmss"));
		
		log.info('Started execution at -' + moment.tz(now, "Asia/Calcutta").format());
		
		let str = (moment.tz(now, "Asia/Calcutta").format()).split("T");
		
		//log.info('Before splitting time - ' + str);
		
		let timecomponent=str[1].split(":");
		
		let timevalue=(parseInt(timecomponent[0])*60)+ parseInt(timecomponent[1]);
		//log.info('Timevalue:'+timevalue);
			
			
		if(timevalue<cfg['start_time'] || timevalue >cfg['end_time']) 
		{
			throw ('Outside Market hours');
		}
		
	
		connection = await mysql.createConnection({
			host: cfg['host'], // host for connection
			port: cfg['port'], // default port for mysql is 3306
			database:cfg['database'],//db
			user: cfg['user'], // username of the mysql connection
			password: cfg['password'] // password of the mysql connection
			});
		
		log.info('Connected to DB');
		
		await connection.execute('SET SESSION MAX_EXECUTION_TIME=1000');	
		await connection.execute('SET autocommit=0');
		
		let [constants,const_fields]= await connection.execute(`Select * from CONSTANTS`);
		
		if (!constants.length)
		{
				throw ('Unable to read global config');
		}
		
		/**var msg_params = {
					  Message: 'Starting LTP threshold updates', 
					  PhoneNumber:constants[0]['SMS_NUMBER'],
					  MessageAttributes: {
								'AWS.SNS.SMS.SMSType': {
									'DataType': 'String',
									'StringValue': 'Transactional'
														}
										}
					};**/
		
		//await msg_send.publish_message(msg_params);
		
		
		//let ltp_percent=constants[0]['LTP_PERCENT_THRESHOLD'];
		
		/*** Pick last hot picks sorted by percent_threshold asc **/
		
		let sql_hot_instruments =`SELECT ZONE, SYMBOL, ENTRY FROM ZONES WHERE ZONE_STATUS='PENDING' order by LTP_DIFFERENCE_PERCENT asc` ;
		let [instruments]= await connection.execute(sql_hot_instruments);
		let j=0,update_sql='';
		
		for(j=0;j<instruments.length;j++)
		{
			try
			{
				let symbol='NSE'+":"+instruments[j]['SYMBOL'];
				
				let resp_ltp = await kc.getLTP(symbol);
				log.info('LTP for - ' + symbol + '-'+resp_ltp[symbol]['last_price']);
					
					
			    let price_diff=abs(resp_ltp[symbol]['last_price']-instruments[j]['ENTRY'])/instruments[j]['ENTRY'];
					
				await connection.execute(`UPDATE ZONES SET LTP_DIFFERENCE_PERCENT=? WHERE SYMBOL=?  AND ZONE = ?`,[price_diff, instruments[j]['SYMBOL'],instruments[j]['ZONE']]);
				await connection.execute(`COMMIT`);
				log.info('Processed -'+'NSE'+instruments[j]['SYMBOL']);
						//msg_params['Message']=x + ' within threshold ';
						//await pub_sms.publish_message(msg_params);	
						//await msg_send.publish_message(msg_params);						
						
			}
			catch(e)
			{
				log.error('Err in processing ', instruments[j]['SYMBOL'],'---', e);
				
			}
		
		
		}
		
	}
	catch(err)
	{
		log.error('Error - ', err);
	}
	finally
	{
		log.info('End of Execution -- destroy connection');
	
		if(connection != undefined)
		{
			await connection.destroy();
		}
	}


		/*** Pick last hot picks sorted by percent_threshold asc **/		
		
		
		/** old logic 
		let sql=`SELECT A.SYMBOL, ENTRY FROM TRADING_BUCKETS A, ZONES B WHERE A.SYMBOL=B.SYMBOL and B.ZONE_STATUS='PENDING'`;
		let [instruments]= await connection.execute(sql);
		let j=0,update_sql='';
		
		
		await connection.execute(`UPDATE TRADING_BUCKETS SET LTP_THRESHOLD_CROSSED="N"`);
		await connection.execute(`COMMIT`);
		
		for(j=0;j<instruments.length;j++)
		{
		
			try
			{
		
					let x ='NSE'+":"+instruments[j]['SYMBOL'];
					
					let resp_ltp = await kc.getLTP(x);
					//log.info('LTP for - ' + x + '-'+resp_ltp[x]['last_price']);
					
					
					let price_diff=abs(resp_ltp[x]['last_price']-instruments[j]['ENTRY'])/instruments[j]['ENTRY'];
					
					if(price_diff<=ltp_percent) //6%
					{
						log.info('LTP for - ' + x + '-'+resp_ltp[x]['last_price']);
						await connection.execute(`UPDATE TRADING_BUCKETS SET LTP_THRESHOLD_CROSSED="Y" WHERE SYMBOL=? `,[instruments[j]['SYMBOL']]);
						await connection.execute(`COMMIT`);
						msg_params['Message']=x + ' within threshold ';
						//await pub_sms.publish_message(msg_params);	
						await msg_send.publish_message(msg_params);						
						
					}
			
			}
			catch(err)
			{
				log.error('Err in processing ', instruments[j]['SYMBOL'],'---', err);
				msg_params['Message']='Err in processing '+ instruments[j]['SYMBOL']+'---'+err;
				//await new pub_sms(msg_params);
				//await sms_msg(msg_params);	
				//await pub_sms.publish_message(msg_params);	
				await msg_send.publish_message(msg_params);
			}
			
		 }
		
		
		
	
	}
	catch(e)
	{
		log.error('Error - ', e);
		msg_params['Message']='Err in processing '+ instruments[j]['SYMBOL']+'---'+err;
		//await pub_sms.publish_message(msg_params);
		await msg_send.publish_message(msg_params);
	}
	finally
	{
		log.info('End of Execution -- destroy connection');
		
		if(connection != undefined)
		{
			await connection.destroy();
		}
	}
	
	old logic **/
}

function sessionHook() {
	log.info("User loggedout");
}