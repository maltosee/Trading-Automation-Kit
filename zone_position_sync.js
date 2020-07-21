'use strict';
var KiteConnect = require("kiteconnect").KiteConnect;
var SimpleNodeLogger = require('simple-node-logger');
var abs = require( 'math-abs' );
var dateFormat = require('dateformat');
var mysql = require('mysql2/promise');
var config_items = require('./load_config.js');
const cfg= new config_items('./config.json');

/**var api_key = "bejtlvvs8bo43qxb",
	secret = "2c3yebbn666rqiea3qcgth4kvqgnkv7p",
	request_token = "hZK5hS18eAThb1EW4Oucz65xNj0n4gaN",
	access_token = "0CmSSkrMX9903zFLTfEP3wYVVs0zYX03";**/

let moment = require("moment-timezone");

let now = moment();

let date_string = dateFormat(new Date(), "yyyymmddhhmmss")+"-zone_position_sync.log";

var log_opts = {
		logFilePath:'logs/'+date_string,
        timestampFormat:'YYYY-MM-DD HH:mm:ss.SSS'
    };
	
var log = SimpleNodeLogger.createSimpleLogger( log_opts );
var options = {
	"api_key": cfg['api_key'],
	"debug": false
};
var connection;

var kc = new KiteConnect(options);
kc.setAccessToken(cfg['access_token']);
kc.setSessionExpiryHook(sessionHook);

var cumulative_risk=0;



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
		
			log.info('Started new execution at ' +dateFormat(new Date(), "yyyymmddhhmmss"));
			
			let str = (moment.tz(now, "Asia/Calcutta").format()).split("T");
			
			//log.info('Before splitting time - ' + str);
			
			let timecomponent=str[1].split(":");
			
			//let cumulative_risk=0;
			
			let timevalue=(parseInt(timecomponent[0])*60)+ parseInt(timecomponent[1]);
			log.info('Timevalue:'+timevalue);
			
			
			if(timevalue<cfg['start_time'] || timevalue >cfg['end_time']) 
			{
				throw (' Outside Market hours');
			}
			
			/**connection = await mysql.createConnection({
			host: 'mysql-01.coqgcxnvqjeu.us-east-1.rds.amazonaws.com', // host for connection
			port: 3306, // default port for mysql is 3306
			database:'FNOTRADING',//db
			user: 'admin', // username of the mysql connection
			password: 'fsnot2020' // password of the mysql connection
			});**/
			
			connection = await mysql.createConnection({
			host: cfg['host'], // host for connection
			port: cfg['port'], // default port for mysql is 3306
			database:cfg['database'],//db
			user: cfg['user'], // username of the mysql connection
			password: cfg['password'] // password of the mysql connection
			});
			
			var instruments =[];
			var instrument_fields =[];
			
			//log.info('Connected to DB');
		
		
			let [constants,const_fields]= await connection.execute(`Select * from CONSTANTS`);
			
			if (!constants.length)
			{
					throw ('Unable to read global config');
			}
			
			let positions= await kc.getPositions();
			let arr_positions=positions['net'];
			
			await connection.execute('SET SESSION MAX_EXECUTION_TIME=1000');
			await connection.execute('SET autocommit=0');
			
			let index =0;
			
			for (index =0; index <arr_positions.length; index++)
			{
				try
				{
					if(arr_positions[index]['quantity']!=0)
					{
						let sql=`Select * from ZONES Z where trade_instrument = ?`;
						[instruments,instrument_fields]= await connection.execute(sql,[arr_positions[index]['tradingsymbol']]);
						
						
						let mult_factor=(instruments[0]['TRADE_INSTRUMENT_TYPE']== 'OPTION'?cfg['mult_factor']:1);
						//log.info('mult factor',mult_factor);
						cumulative_risk+= Math.round(abs(arr_positions[index]['quantity']*(instruments[0]['STOP_LOSS']-instruments[0]['ENTRY'])))*mult_factor;
						//log.info('Cumulative risk -',cumulative_risk);
						await connection.execute(`UPDATE ZONES SET ZONE_STATUS='POSITION' WHERE TRADE_INSTRUMENT = ?`, [arr_positions[index]['tradingsymbol']]);
						
					}
					else
					{
						cumulative_risk+=-1* Math.round(arr_positions[index]['pnl']);
						await connection.execute(`UPDATE ZONES SET ZONE_STATUS='CLOSED' WHERE TRADE_INSTRUMENT = ?`, [arr_positions[index]['tradingsymbol']]);
					}
					
					await connection.execute('COMMIT');
				}
				catch(e)
				{
					log.error('Error while syncing position for '+arr_positions[index]['tradingsymbol']+ '-'+ e);
				}
			
			}
		
		
	}
	catch(err)
	{
		log.error('Error -'+err);
		
	}
	finally
	{
		if(cumulative_risk)
		{
				log.info('Updating risk');
				await connection.execute(`UPDATE CONSTANTS SET  CURRENT_RISK = ? `,[cumulative_risk]);
				await connection.execute('COMMIT');
		}
		
		log.info('End of Execution -- destroy connection');
		if(connection != undefined)
		{
			await connection.destroy();
		}
		
	}
	
}


function sessionHook() {
	log.info("User loggedout");
}
