'use strict';
var KiteConnect = require("kiteconnect").KiteConnect;
var KiteTicker = require("kiteconnect").KiteTicker;
var SimpleNodeLogger = require('simple-node-logger');
var abs = require( 'math-abs' );
var dateFormat = require('dateformat');
var mysql = require('mysql2/promise');
//var Risk=require('./riskcompute.js');
//var Order_place=require('./order_place.js');

var  moment = require("moment-timezone");
var now = moment();

var config_items = require('./load_config.js');
const cfg= new config_items('./config.json');

var cumulative_risk=0;

//const orders_placed=[];
//var lockFile1 = require("lockfile");
//const lockfile="some-file.lock";
var tokenMap = {};

var connection;

/**var api_key = "bejtlvvs8bo43qxb",
	secret = "2c3yebbn666rqiea3qcgth4kvqgnkv7p",
	request_token = "iNcfCZZhx6tggCvsDEiqrZHBYHsaqJZI",
	access_token = "0CmSSkrMX9903zFLTfEP3wYVVs0zYX03";**/
	
var options = {
	"api_key": cfg['api_key'],
	"debug": false
};

let date_string = dateFormat(new Date(), "yyyymmddhhmmss")+"-sl-.log";
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



/** load from file instead of this
if(!access_token) {
	//console.log("before generateSession");
	log.info("Before session generation");
	kc.generateSession(request_token, secret)
		.then(function(response) {
			console.log("Response", response);
		})
		.catch(function(err) {
			log.error("Error in session generation",err);
			console.log(err);
		})
} else {
	kc.setAccessToken(access_token);
	//init();
}
**/

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
		
		log.info('Started new execution at ' +dateFormat(new Date(), "yyyymmddhhmmss"));
		
		let str = (moment.tz(now, "Asia/Calcutta").format()).split("T");
		
		let timecomponent=str[1].split(":");
		var instruments =[];
		var instrument_fields =[];
	
		
		let timevalue=(parseInt(timecomponent[0])*60)+ parseInt(timecomponent[1]);
		//log.info('Timevalue:'+timevalue);
		
		
		if(timevalue<cfg['start_time'] || timevalue >cfg['end_time']) 
		{
			throw (' Outside Market hours');
		}
		
	/**	if(timecomponent[1] < 10 || timecomponent[1]>30) 
		{
			
			throw ('time component 1 Outside market hours');
		} 
	**/
		
	/**	connection = await mysql.createConnection({
		host: 'mysql-01.coqgcxnvqjeu.us-east-1.rds.amazonaws.com', // host for connection
		port: 3306, // default port for mysql is 3306
		database:'FNOTRADING',//db
		user: 'admin', // username of the mysql connection
		password: 'fsnot2020' // password of the mysql connection
		});
		**/
		
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
		
		
		//let arr_positions= await get_position_instruments();
		
		let positions= await kc.getPositions();
		let arr_positions=positions['net'];
		
		log.info('Positions -'+JSON.stringify(arr_positions));
		
		
		let arr_orders = await kc.getOrders();
		
	//	log.info('Orders history -'+arr_orders);
		
		
		await connection.execute('SET SESSION MAX_EXECUTION_TIME=1000');
		await connection.execute('SET autocommit=0');
		
		
		
		let j=0, orders_placed=[],params={},resp={},order_resp={}, index=0,sql='', trans_type='' ;
		//let total_risk=risk_resp['risk'];
		
		
		for (index =0; index <arr_positions.length; index++)
		{
			
			if(arr_positions[index]['quantity']!=0)
			{
					try
					{		
								sql=`Select * from ZONES Z where trade_instrument = ?`;
								
								[instruments,instrument_fields]= await connection.execute(sql,[arr_positions[index]['tradingsymbol']]);
					
					
								
								//log.info('Instrument --'+ JSON.stringify(instruments[j]));
								
								let x ='NSE'+":"+instruments[0]['SYMBOL'];
								
								//let resp_ltp = await kc.getLTP(x);
								let resp_ohlc= await kc.getOHLC(x);
								log.info('LTP - ',resp_ohlc[x]);
								
								let sl_hit=0, tgt_hit=0, sl_readjust=0;
								
								trans_type=(instruments[0]['ENTRY']>instruments[0]['TARGET'])?"SELL":"BUY";
								
			
								
								let mult_factor=(instruments[0]['TRADE_INSTRUMENT_TYPE']== 'OPTION'?0.4:1);
								
								if(trans_type=="SELL")
								{
									//log.info('SELL');
									if(instruments[0]['STOP_LOSS']< resp_ohlc[x]['last_price'])
									{
										sl_hit=1;
									}
									else if(resp_ohlc[x]['last_price']<=instruments[0]['TARGET']) 
									{
										tgt_hit=1; 
									
									}
									
									if((resp_ohlc[x]['last_price'] < instruments[0]['ENTRY'])&& (resp_ohlc[x]['last_price'] > instruments[0]['TARGET']))
									{
										if ((abs(resp_ohlc[x]['last_price']-instruments[0]['ENTRY'])/instruments[0]['ENTRY'])>=constants[0]['SL_READJUST_PERCENT'])
										{
											
											sl_readjust=1;
										}
									}
									
								}
								else
								{
									//log.info('BUY');
									if(instruments[0]['STOP_LOSS']> resp_ohlc[x]['last_price'])
									{
										sl_hit=1;
									}
									else if(resp_ohlc[x]['last_price']>=instruments[0]['TARGET']) 
									{
										tgt_hit=1; 
									
									}
									
									if((resp_ohlc[x]['last_price'] > instruments[0]['ENTRY'])&& (resp_ohlc[x]['last_price'] < instruments[0]['TARGET']))
									{
										if ((abs(resp_ohlc[x]['last_price']-instruments[0]['ENTRY'])/instruments[0]['ENTRY'])>=constants[0]['SL_READJUST_PERCENT'])
										{
											
											sl_readjust=1;
										}
									}
					
								}
								
								
								//let price_diff=abs(resp_ltp[x]['last_price']-instruments[j]['STOP_LOSS'])/resp_ltp[x]['last_price'];
							
								
								if(sl_hit || tgt_hit) 
								{
								
											 log.info('Squaring off position - '+ arr_positions[index]);
											 
											 if(instruments[0]['TRADE_INSTRUMENT_TYPE'] == 'OPTION')
											 {
													
													let liquidity=0, limit_price=0;
													
													let top_key=instruments[0]['EXCHANGE']+":"+instruments[0]['TRADE_INSTRUMENT'];
													
													/** check order history for the day**/
													for (let i=0; i< arr_orders.length; i++)
													{
													   if((arr_orders[i]['tradingsymbol']==instruments[0]['TRADE_INSTRUMENT'])&& 
														   arr_orders[i]['transaction_type']=="SELL")
														{
															if(arr_orders[i]['status']=='OPEN' || arr_orders[i]['status']=='AMO REQ RECEIVED')
															{
																throw('Pending square off order already exists for '+ top_key);
															}
														}
													}
													
													
													let mkt_depth = await kc.getQuote(top_key);
													
													log.info('Market Depth for '+ instruments[0]['TRADE_INSTRUMENT']+' is '+ JSON.stringify(mkt_depth));
																						
													liquidity=mkt_depth[top_key]['depth']['buy'][0]['quantity'];
													
													if(liquidity<=0) 
													{
															limit_price=mkt_depth[top_key]['last_price'];
															//throw('No liquidity for '+instruments[j]['TRADE_INSTRUMENT']);
													}
													else
													{
															limit_price = mkt_depth[top_key]['depth']['buy'][0]['price'];
													}
													
													if(limit_price<=0)
													{
															throw('Error in getting LTP for '+instruments[0]['TRADE_INSTRUMENT']);
													}
													
													order_resp = await kc.placeOrder(constants[0]['ORDER_TYPE'], {
																	"exchange": instruments[0]['EXCHANGE'],
																	"tradingsymbol": instruments[0]['TRADE_INSTRUMENT'],
																	"transaction_type": "SELL", // always SELL the option as square off
																	"quantity": instruments[0]['LOT'],
																	"product": "NRML",
																	"order_type": "LIMIT",
																	"price":limit_price
																});
												
												
											 }
											 else
											 {
												 
												 let sqoff_type=(instruments[0]['ENTRY']>instruments[0]['TARGET'])?"BUY":"SELL";// reverse logic of place order
												 log.info('Before calling place order for -',params.SYMBOL);
												//let pc=new Order_place(params);
												 order_resp = await kc.placeOrder(constants[0]['ORDER_TYPE'], {
																"exchange": instruments[0]['EXCHANGE'],
																"tradingsymbol": params.SYMBOL,
																"transaction_type":sqoff_type,
																"quantity": instruments[0]['LOT'],
																"product": "NRML",
																"order_type": "MARKET"
															});
												 
											 }
											 
											 
															
											//resp=await pc.place_order(kc);
											
											log.info('After calling sl order for -',params.SYMBOL);
											log.info('Order Id  -',order_resp.order_id);
											
											if (!order_resp.order_id)
											{
													throw('Couldnt place order for '+params.SYMBOL);
											}
											
											//await connection.execute(`UPDATE ZONES SET ZONE_STATUS='CLOSED' WHERE TRADE_INSTRUMENT = ?`, [arr_positions[index]['tradingsymbol']]);
											
								}
								else
								{
										
									//cumulative_risk+= Math.round(abs(arr_positions[index]['quantity']*(instruments[0]['STOP_LOSS']-resp_ohlc[x]['last_price'])))*mult_factor;
									
									//log.info('Risk -- '+ cumulative_risk);
									
									if(sl_readjust)
									{
										log.info('Readjusting trailing SL -'+  instruments[0]['TRADE_INSTRUMENT']);
										await connection.execute(`UPDATE ZONES SET STOP_LOSS= ENTRY WHERE ZONE =? `, [instruments[0]['ZONE']]);
										await connection.execute('COMMIT');
										
									}
									
									
								}
										
							}
							catch(err)
							{
									log.error('Err in processing ', instruments[0]['SYMBOL'],'---', err);
							}
					
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

/** async function get_position_instruments()
{
	let positions= await kc.getPositions();
	let results=positions['net'];
	let arr=[];
	
	
	log.info('In get Positions - ', results);
	
	for (let i=0; i<results.length; i++)
	{
			arr.push(results[i]['tradingsymbol']);
	}
	
    return arr;
} **/

