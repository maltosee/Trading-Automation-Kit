"use strict";
var KiteConnect = require("kiteconnect").KiteConnect;
//var KiteTicker = require("kiteconnect").KiteTicker;
var SimpleNodeLogger = require('simple-node-logger');
const fs = require('fs');
var dateFormat = require('dateformat');
var abs = require( 'math-abs' );
var  moment = require("moment-timezone");
var now = moment();

//console.log('Before load config');

var config_items = require('./load_config.js');

//console.log('after load config.. argyment '+ process.argv[2]);

const cfg_static =  new config_items(process.argv[2]);

//console.log('after creating cfg_static -- '+ JSON.stringify(cfg_static));
//console.log('zone file -'+cfg_static['zone_file_path']);

const cfg_trades= new config_items(cfg_static['zone_file_path']);

//console.log('after creating cfg_trades');


//const accountSid = 'ACd9e70d2f8cb3bc946caef5b4acde9117';
//const authToken = '064f1fd797bb147b91887557eedceede';
const client = require('twilio')(cfg_static['twilio_sid'], cfg_static['twilio_token']);
//const client =require('twilio')(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN);

var max_positions, running=true;


var options = {
	"api_key": cfg_static['api_key'],
	"debug":false 
};



let date_string = dateFormat(new Date(), "yyyymmddhh")+"-squareoff-"+ process.argv[2]+".log";
console.log('log file path - ',date_string);


var log_opts = {
		logFilePath:'logs/'+date_string,
        timestampFormat:'YYYY-MM-DD HH:mm:ss.SSS'
    };
	

var log = SimpleNodeLogger.createSimpleLogger( log_opts );
var current_risk=0;

var instruments=[], items=[], risk_buffer=0;

var kc = new KiteConnect(options);
kc.setAccessToken(cfg_static['access_token']);
kc.setSessionExpiryHook(sessionHook);

//var result = square_off_tgt_sl();

//log.info('Positions - ' , result);


square_off_tgt_sl().then
(
		function(resp) 
		{
			log.info('Back to main loop after main logic with no uncaught exceptions- ',resp);
		}
		
		//await square_off_tgt_sl();
		
).catch(
	function(err) 
	{
		log.error('uncaught error in main logic ',err);
		client.messages
				  .create({
					 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
					 body: 'In Position Square off -' + JSON.stringify(err),
					 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
				   });
	}
); 





function sessionHook() {
	log.info("User loggedout");
}



async function time_check(timezone, start_time, end_time)
{
			let str = (moment.tz(now, timezone).format()).split("T");
			let timecomponent=str[1].split(":");
			let timevalue=(parseInt(timecomponent[0])*60)+ parseInt(timecomponent[1]);
			//log.info('Time value -' ,timevalue, ' Start Time -', start_time, ' End time -', end_time);
			//let running=true;
			
			if(timevalue<start_time || timevalue >end_time) 
			{
				return false;
			}
			
			return true;
	
}



async function square_off_tgt_sl()
{
		var positions; 
		var results;
		
		let arr_orders = await kc.getOrders();
		
		var trade, sl_hit=0, tgt_hit=0, sl_readjust=0,arr=[],mult_factor=1, trans_type;
		
		var run;
		
		if(!await time_check("Asia/Calcutta",cfg_static['start_time'],cfg_static['end_time']))
		{
				log.info('Outside market hours -',cfg_static['start_time'],' - ', cfg_static['end_time']);
				return arr;
		}
		
		while(true)
		{
		  
			  try
			  {

						positions={};
						positions = await kc.getPositions();
						results=positions['net'];
						current_risk=0;
						max_positions=0;
						
						//log.info('Looping through -', JSON.stringify(results));
						
						for (let index =0; index <results.length; index++)
						{

										log.info('Processing -', JSON.stringify(results[index]['tradingsymbol']));
										
										if(results[index]['quantity']!=0)
										{
												//log.info('Searching for trading instrument in json config -',JSON.stringify(cfg_trades));
											
												let sqoff_order_resp={}, option_limit_order_exists=false;
												
												trade = cfg_trades.find(trade => (trade['TRADE_INSTRUMENT'] == results[index]['tradingsymbol']));
												
												
												
												if(trade == undefined)
												{
													log.error ('Catastrophe -- position not found in file for ', results[index]['tradingsymbol']);
													
													await client.messages
														  .create({
															 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
															 body: 'position not found in file for '+results[index]['tradingsymbol'],
															 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
														   });
													throw('Stop loss config missing for -' + results[index]['tradingsymbol']);
													
												}
												else
												{
												
														log.info('Position stop loss config - ', JSON.stringify(trade));
												
														trans_type=(trade['ENTRY']>trade['TARGET'])?"SELL":"BUY";
														
														mult_factor=(trade['TRADE_INSTRUMENT_TYPE']== 'OPTION'?cfg_static['mult_factor']:1);
														
														current_risk+= Math.round(abs((trade['STOP_LOSS']-trade['ENTRY'])*trade['LOT_SIZE']*mult_factor));
														
														let x ='NSE'+":"+trade['SYMBOL'];
														let resp_ohlc= await kc.getOHLC(x);
													
														if(trans_type=="SELL")
														{
																//log.info('SELL');
																if(trade['STOP_LOSS']< resp_ohlc[x]['last_price'])
																{
																	sl_hit=1;
																}
																else if(resp_ohlc[x]['last_price']<=trade['TARGET']) 
																{
																	tgt_hit=1; 
																
																}
																
														}
														else
														{
															if(trade['STOP_LOSS']> resp_ohlc[x]['last_price'])
															{
																sl_hit=1;
															}
															else if(resp_ohlc[x]['last_price']>=trade['TARGET']) 
															{
																tgt_hit=1; 
															
															}
														}
												
												
														if(sl_hit || tgt_hit) 
														{
															
																if(trade['TRADE_INSTRUMENT_TYPE'] == 'OPTION')
																{
																							
																	let liquidity=0, limit_price=0;
																	
																	let top_key=trade['EXCHANGE']+":"+trade['TRADE_INSTRUMENT'];
																	
																	
																	/** check order history for the day**/
																	for (let i=0; i< arr_orders.length; i++)
																	{
																	   if((arr_orders[i]['tradingsymbol']==trade['TRADE_INSTRUMENT'])&& 
																		   arr_orders[i]['transaction_type']=="SELL")
																		{
																			
																				option_limit_order_exists=true;
																				log.error('square off order already exists for ', top_key);
																				
																				await client.messages
																				  .create({
																					 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																					 body: 'Square off order already exists for ', top_key,
																					 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
																				   });
																				 
																		 
																		}
																	}
																		
																			
																	if(!option_limit_order_exists)
																	{
																		
																			let mkt_depth = await kc.getQuote(top_key);
																			
																			log.info('Market Depth for '+ trade['TRADE_INSTRUMENT']+' is '+ JSON.stringify(mkt_depth));
																												
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
																					log.error('In Square off : Error in getting limit price for ',trade['TRADE_INSTRUMENT']);
																					await client.messages
																						  .create({
																							 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																							 body: 'In Square off : Error in getting limit price for '+trade['TRADE_INSTRUMENT'],
																							 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
																						   });
																						  
																			}
																			else
																			{
																			
																					log.info('placing order with trade instrument - ', trade['EXCHANGE']+":"+trade['TRADE_INSTRUMENT'], ' - product - ',cfg_static['fno_product'],' limit - ', limit_price, '-type of order - ',cfg_static['order_type'] );
																					
																					sqoff_order_resp = await kc.placeOrder(cfg_static['order_type'], {
																								"exchange": trade['EXCHANGE'],
																								"tradingsymbol": trade['TRADE_INSTRUMENT'],
																								"transaction_type": "SELL", // always SELL the option as square off
																								"quantity": trade['LOT_SIZE'],
																								"product": cfg_static['fno_product'],
																								"order_type": "LIMIT",
																								"price":limit_price
																							});
																			 }
																	}						
																						
																}
																else
																{
																	 
																	 let sqoff_type=(trade['ENTRY']>trade['TARGET'])?"BUY":"SELL";// reverse logic of place order
																	 let product_type=(trade['TRADE_INSTRUMENT_TYPE']=="CASH")?cfg_static['cash_product']:cfg_static['fno_product'];
																	 
																	 
																	 log.info('Before calling place order for -',trade['SYMBOL'],' with product ',product_type );
																	//let pc=new Order_place(params);
																	 sqoff_order_resp = await kc.placeOrder(cfg_static['order_type'], {
																					"exchange": trade['EXCHANGE'],
																					"tradingsymbol": trade['TRADE_INSTRUMENT'],
																					"transaction_type":sqoff_type,
																					"quantity": trade['LOT_SIZE'],
																					"product": product_type,
																					"order_type": "MARKET"
																				});
																	 
																 }
															
														
																if (sqoff_order_resp.order_id == undefined)
																{
																	if(!option_limit_order_exists)
																	{
																			log.error('Couldnt place square off order for ',trade['SYMBOL']);
																			
																			await client.messages
																			  .create({
																				 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																				 body: 'Couldnt place order for '+trade['SYMBOL'],
																				 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
																			   });
																			  
																	}
																}
																else
																{
																	
																	arr.push(trade['TRADE_INSTRUMENT']);
																	await client.messages
																	  .create({
																		 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																		 body: 'Squareoff order id  '+sqoff_order_resp.order_id,
																		 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
																	   });
																	  
																	
																	
																}
														
														}
														else
														{
															max_positions++;
														}
												 }
										
										}
										else
										{
											
											current_risk+=-1*results[index]['pnl'];
											//log.info('Updating risk from PNL - ', current_risk);
											
										}
				 
								}

						 
			 

			   }
			   catch(err)
			   {
					  log.error('uncaught error in main logic ',err);
					  client.messages
						  .create({
							 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
							 body: 'In Position Square off -' + JSON.stringify(err),
							 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
						   });
			   }
		 }

		
		return arr;
}

