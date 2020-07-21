'use strict';
var KiteConnect = require("kiteconnect").KiteConnect;
var KiteTicker = require("kiteconnect").KiteTicker;
var SimpleNodeLogger = require('simple-node-logger');
var abs = require( 'math-abs' );
var dateFormat = require('dateformat');
var mysql = require('mysql2/promise');
var config_items = require('./load_config.js');
const cfg= new config_items('./config.json');

var  moment = require("moment-timezone");
var now = moment();

//const orders_placed=[];
//var lockFile1 = require("lockfile");
//const lockfile="some-file.lock";
var tokenMap = {};

//const bucket_id=process.argv[2];
var connection;


	
var options = {
	"api_key": cfg['api_key'],
	"debug": false
};

let date_string = dateFormat(new Date(), "yyyymmddhhmmss")+'.log';
const curr_date=dateFormat(new Date(), "yyyymmdd");
console.log('log file path - ',date_string);

var log_opts = {
		logFilePath:'logs/'+date_string,
        timestampFormat:'YYYY-MM-DD HH:mm:ss.SSS'
    };
	

	
var log = SimpleNodeLogger.createSimpleLogger( log_opts );


var instruments=[], items=[], risk_buffer=0;

var kc = new KiteConnect(options);
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
	//let bucket_lock=0;
	try
	{	
		
		log.info('Started new execution at ' +dateFormat(new Date(), "yyyymmddhhmmss"));
		
		let str = (moment.tz(now, "Asia/Calcutta").format()).split("T");
		
		log.info('Before splitting time - ' + str);
		
		let timecomponent=str[1].split(":");
		
		let timevalue=(parseInt(timecomponent[0])*60)+ parseInt(timecomponent[1]);
		log.info('Timevalue:'+timevalue);
		
		
		if(timevalue<cfg['start_time'] || timevalue >cfg['end_time']) 
		{
			throw (' Outside Market hours');
		}
		
		connection = await mysql.createConnection({
			host: cfg['host'], // host for connection
			port: cfg['port'], // default port for mysql is 3306
			database:cfg['database'],//db
			user: cfg['user'], // username of the mysql connection
			password: cfg['password'] // password of the mysql connection
			});

		log.info('Connected to DB');
		
		
		let [constants,const_fields]= await connection.execute(`Select * from CONSTANTS`);
		
		if (!constants.length)
		{
				throw ('Unable to read global config');
		}
		
		log.info('Constants config -', constants[0]);
		
		if(constants[0]['CURRENT_RISK']>=constants[0]['MAX_RISK'])
		{
				throw ('Max risk reached , skipping bucket - '+bucket_id);
		}
		
		risk_buffer=constants[0]['MAX_RISK']-constants[0]['CURRENT_RISK'];
		
		
		//var risk_compute=new Risk(connection, kc);
		
		let arr_positions= await get_position_instruments();
		
		if (arr_positions.length>constants[0]['MAX_POSITIONS'])
		{
			throw('Max positions exiting ');
		}
		
		let arr_orders = await kc.getOrders();
		
		
		
		
		await connection.execute('SET SESSION MAX_EXECUTION_TIME=1000');
		await connection.execute('SET autocommit=0');
		// No more bucket logic
		
	
		
		let sql=`Select * from ZONES where ZONE_STATUS='PENDING' order by LTP_DIFFERENCE_PERCENT asc LIMIT 0, ?`;
		
		let [instruments,instru_fields]= await connection.execute(sql,[constants[0]['NUMBER_FOR_ORDER_PLACE']]);
		
		
		
		let j=0, orders_placed=[],params={},resp={},order_resp={} ;
		//let total_risk=risk_resp['risk'];
		
		
		for(j=0;j<instruments.length;j++)
		{
			try
			{
					/** Position Check **/
					if (arr_positions.indexOf(instruments[j]['TRADE_INSTRUMENT'])>=0)
					{
						throw('Position already exists for -'+instruments[j]['SYMBOL']);
					}
					
				
					
					let x ='NSE'+":"+instruments[j]['SYMBOL'];
					
					let resp_ltp = await kc.getLTP(x);
					log.info('LTP - ',resp_ltp[x]);
					
					
					let price_diff=abs(resp_ltp[x]['last_price']-instruments[j]['ENTRY'])/instruments[j]['ENTRY'];
					let ltp_within_zone=0;
					
					params.TYPE=(instruments[j]['ENTRY']>instruments[j]['TARGET'])?"SELL":"BUY";
					
					if(params.TYPE =='SELL')
					{
						if((resp_ltp[x]['last_price']<instruments[j]['STOP_LOSS']) &&(resp_ltp[x]['last_price']>=instruments[j]['ENTRY']))
						{
							ltp_within_zone=1;
						}
					}
					else
					{
						if((resp_ltp[x]['last_price']>instruments[j]['STOP_LOSS']) &&(resp_ltp[x]['last_price']<=instruments[j]['ENTRY']))
						{
							ltp_within_zone=1;
						}
						
					}
					
				
					
					if(ltp_within_zone) //0.4%
					{
						
							//const order_type='regular';
							
							try
							{
								let order_risk= abs(instruments[j]['STOP_LOSS']-instruments[j]['ENTRY'])*instruments[j]['LOT_SIZE'];
								
								if (order_risk >risk_buffer)
								{
										log.error('Order risk -', order_risk ,'- greater than risk buffer -',risk_buffer);
										throw ('Risky order.. skipping');
								}
								 
								
								 params.SYMBOL=instruments[j]['TRADE_INSTRUMENT'];
								 params.LOT=instruments[j]['LOT'];
								 //params.TAG=rounded_sl_diff;
								 params.ENTRY=instruments[j]['ENTRY'];
								 params.STOP_LOSS=instruments[j]['STOP_LOSS'];
								 params.TARGET=instruments[j]['TARGET'];
								 params.EXCHANGE=instruments[j]['EXCHANGE'];
								 
								 if(instruments[j]['TRADE_INSTRUMENT_TYPE'] == 'OPTION')
								 {
										
										let top_key=instruments[j]['EXCHANGE']+":"+instruments[j]['TRADE_INSTRUMENT'];
										
										/** check order history for the day**/
										for (let i=0; i< arr_orders.length; i++)
										{
											if(arr_orders[i]['tradingsymbol']==instruments[j]['TRADE_INSTRUMENT'])
											{
												if(arr_orders[i]['status']=='OPEN' || arr_orders[i]['status']=='AMO REQ RECEIVED')
												{
													throw('Pending order already exists for '+ top_key);
												}
											}
										}
										
										
										
										let mkt_depth = await kc.getQuote(top_key);
										
										log.info('Market Depth for '+ params.SYMBOL+' is '+ JSON.stringify(mkt_depth));
																			
										params.liquidity=mkt_depth[top_key]['depth']['sell'][0]['quantity'];
										
										if(params.liquidity<=0) 
										{
												params.limit_price=mkt_depth[top_key]['last_price'];
												//throw('No liquidity for '+instruments[j]['TRADE_INSTRUMENT']);
										}
										else
										{
												params.limit_price = mkt_depth[top_key]['depth']['sell'][0]['price'];
										}
										
										if(params.limit_price<=0)
										{
												throw('Error in getting LTP for '+instruments[j]['TRADE_INSTRUMENT']);
										}
										order_resp = await kc.placeOrder(constants[0]['ORDER_TYPE'], {
														"exchange": params.EXCHANGE,
														"tradingsymbol": params.SYMBOL,
														"transaction_type": params.TYPE,
														"quantity": instruments[j]['LOT'],
														"product": "NRML",
														"order_type": "LIMIT",
														"price":params.limit_price
													});
									
									
								 }
								 else
								 {
									 log.info('Before calling place order for -',params.SYMBOL);
									//let pc=new Order_place(params);
									 order_resp = await kc.placeOrder(constants[0]['ORDER_TYPE'], {
													"exchange": params.EXCHANGE,
													"tradingsymbol": params.SYMBOL,
													"transaction_type": params.TYPE,
													"quantity": instruments[j]['LOT'],
													"product": "NRML",
													"order_type": "MARKET"
												});
									 
								 }
								 
								 
								
								
								log.info('After calling place order for -',params.SYMBOL);
								log.info('Order Id  -',order_resp.order_id);
								
								if (!order_resp.order_id)
								{
										throw('Couldnt place order for '+params.SYMBOL);
								}
								
								risk_buffer=risk_buffer-(abs(instruments[j]['STOP_LOSS']-instruments[j]['ENTRY'])*instruments[j]['LOT_SIZE']);
					
								
								
							}
							catch(err)
							{
								//log.error('Error in placing order for ',instruments[j]['SYMBOL'],' err is ', err);
								log.error(err);
							}
					 }
					 
				
			
			}
			catch(err)
			{
					log.error('Err in processing ', instruments[j]['SYMBOL'],'---', err);
			}
		
		 }
		
		
		
	}
	catch(e)
	{
		log.error('Error - ', e);
	}
	finally
	{
	    
		log.info('End of Execution -- destroy connection');
		
		if(connection != undefined)
		{
			//await connection.execute(`UPDATE BUCKETS SET LOCKED='N' WHERE bucket_id=? `, [bucket_id]);
			//await connection.execute(`COMMIT`);
			//log.info('After unlocking bucket -'+bucket_id);
			await connection.destroy();
		}
	
	}
	
}


function sessionHook() {
	log.info("User loggedout");
}

function sleep(ms)
{
	//log.info('Sleeping ');
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function get_position_instruments()
{
	let positions= await kc.getPositions();
	let results=positions['net'];
	let arr=[];
	
	
	log.info('In get Positions - ', results);
	
	for (let i=0; i<results.length; i++)
	{
			arr.push(results[i]['tradingsymbol']);
	}
	log.info('Transformed array -',arr);
	
    return arr;
}

