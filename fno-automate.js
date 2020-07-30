"use strict";
var KiteConnect = require("kiteconnect").KiteConnect;
//var KiteTicker = require("kiteconnect").KiteTicker;
var SimpleNodeLogger = require('simple-node-logger');
const fs = require('fs');
var dateFormat = require('dateformat');
var abs = require( 'math-abs' );
var  moment = require("moment-timezone");
var now = moment();
var url = require('url');
//console.log('Before load config');

var config_items = require('./load_config.js');

//console.log('after load config.. argyment '+ process.argv[2]);

const cfg_static =  new config_items(process.argv[2]);

//console.log('after creating cfg_static -- '+ JSON.stringify(cfg_static));
//console.log('zone file -'+cfg_static['zone_file_path']);

const cfg_trades= new config_items(cfg_static['zone_file_path']);

const master_trades= new config_items(cfg_static['master_zone_file_path']);

//console.log('after creating cfg_trades');


//const accountSid = 'ACd9e70d2f8cb3bc946caef5b4acde9117';
//const authToken = '064f1fd797bb147b91887557eedceede';
const client = require('twilio')(cfg_static['twilio_sid'], cfg_static['twilio_token']);

const futures_margins = url.parse('https://api.kite.trade/margins/futures');



var max_positions, running=true,current_risk=0;
var instruments=[], items=[], risk_buffer=0;


var options = {
	"api_key": cfg_static['api_key'],
	"debug":false 
};

let date_string = dateFormat(new Date(), "yyyymmddhh")+"-fnoautomate-"+ process.argv[2]+".log";
console.log('log file path - ',date_string);

var log_opts = {
		logFilePath:'logs/'+date_string,
        timestampFormat:'YYYY-MM-DD HH:mm:ss.SSS'
    };

var log = SimpleNodeLogger.createSimpleLogger( log_opts );




var kc = new KiteConnect(options);
kc.setAccessToken(cfg_static['access_token']);
kc.setSessionExpiryHook(sessionHook);


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
				
				//let str = (moment.tz(now, "Asia/Calcutta").format()).split("T");
				///let timecomponent=str[1].split(":");
				//let timevalue=(parseInt(timecomponent[0])*60)+ parseInt(timecomponent[1]);
				//let running=true;
				
			/**	if(timevalue<cfg_static['start_time'] || timevalue >cfg_static['end_time']) 
				{
					log.info(' Outside Market hours');
					running=false;
				}**/
				
				
				if(await time_check("Asia/Calcutta",cfg_static['start_time'],cfg_static['end_time']))
				{
				
				
						let index=0,arr_positions=[],zones=[],trade_type ='';
				
			
				
						while(running)
						{
				
					
							 try
							 {
									current_risk=0;
									max_positions=0;
									//log.info('Config trades -'+ JSON.stringify(cfg_trades));
									
								//	log.info('before calling square off');
									arr_positions = await get_position_instruments();
									
									log.info('after calling square off , risk -', current_risk);
									
									if(max_positions>cfg_static['max_positions'])
									{
										throw('Max positions for the day.. skipping everything');
									}
									
				
				//					arr_positions = await get_position_instruments();
									
								//	log.info('Existing positions -', arr_positions);
									
									risk_buffer= cfg_static['max_risk']-current_risk;
									
									//log.info('Before filtering');
									
									zones = await filter_existing_positions(arr_positions);
									
									//log.info('after filtering out');
									//log.info('Zones -',zones);
									//log.info('Current risk :', current_risk, ' Risk Buffer :', risk_buffer);
									
									let arr_orders = await kc.getOrders();
									
									for (index=0; index<zones.length; index++)
									{
											
											if(risk_buffer>0)
											{
													
													let x= "NSE:"+zones[index]['SYMBOL'];
													log.info('Iteration - ',index.toString(),' - symbol ',x,' Zone -', zones[index]['ZONE']);
													
													
													let resp_ltp = await kc.getLTP(x);
													//log.info('LTP - ',resp_ltp[x]);
													
													
													let price_diff=abs(resp_ltp[x]['last_price']-zones[index]['ENTRY'])/zones[index]['ENTRY'];
													let ltp_within_zone=0;
													
													
													trade_type=(zones[index]['ENTRY']>zones[index]['TARGET'])?"SELL":"BUY";
													
													//log.info('Trade type for ' , x,' is ', trade_type, ' last price is ',resp_ltp[x]['last_price'] );
													//log.info('Zone SL - ', zones[index]['STOP_LOSS'], ' Entry ', zones[index]['ENTRY']);
													
													if(trade_type =='SELL')
													{
														if((resp_ltp[x]['last_price']<zones[index]['STOP_LOSS']) &&(resp_ltp[x]['last_price']>=zones[index]['ENTRY']))
														{
															ltp_within_zone=1;
														}
													}
													else
													{
														if((resp_ltp[x]['last_price']>zones[index]['STOP_LOSS']) &&(resp_ltp[x]['last_price']<=zones[index]['ENTRY']))
														{
															ltp_within_zone=1;
														}
														
													}
													
													if(ltp_within_zone)
													{
														
															let option_limit_order_exists=false, new_order_resp={};
															let user_margin_response={};
															let net_margin=0, reqd_margin=0;
															
															log.info('filtered zone ', JSON.stringify(zones[index]));
															
															
															let order_risk= abs(zones[index]['ENTRY']-zones[index]['STOP_LOSS'])*zones[index]['LOT_SIZE'];
														
															if(order_risk>risk_buffer)
															{
																log.error('Order risk for zone -',zones['SYMBOL'],' exceeds risk buffer -', risk_buffer);
																risk_buffer=risk_buffer-(abs(zones[index]['STOP_LOSS']-zones[index]['ENTRY'])*zones[index]['LOT_SIZE']);
																	  
																await client.messages
																			  .create({
																				 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																				 body: 'Order risk for zone -'+zones[index]['SYMBOL']+' exceeds risk buffer '+risk_buffer,
																				 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
																			   });
																
															}
															else // place order
															{
																
																user_margin_response = await kc.getMargins("equity");
																
																
																net_margin= user_margin_response['net'];
																
															//	log.info('user margin data',JSON.stringify(user_margin_response));
																
																
																
																if(net_margin <=0)
																{
																	throw('Cant fetch margin for '+ zones[index]['TRADE_INSTRUMENT']);
																	
																}
																
																
																if(zones[index]['TRADE_INSTRUMENT_TYPE'] == 'OPTION')
																{
																		
																		let top_key=zones[index]['EXCHANGE']+":"+zones[index]['TRADE_INSTRUMENT'];
															
																		/** check order history for the day**/
																		for (let i=0; i< arr_orders.length; i++)
																		{
																			if((arr_orders[i]['tradingsymbol']==zones[index]['TRADE_INSTRUMENT'])&& 
																			arr_orders[i]['transaction_type']=="BUY")
																			{

																					log.info('Pending order already exists for ', top_key);
																					option_limit_order_exists=true;
																					
																					await client.messages
																					  .create({
																						 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																						 body: 'Taking new position : Pending  order already exists for ' + arr_orders[i]['tradingsymbol'],
																						 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
																					   });
																					  
																			}
																		 }
															
															
																			if(!option_limit_order_exists)
																			{
																					let mkt_depth = await kc.getQuote(top_key);
																					
																					log.info('Market Depth for '+ zones[index].SYMBOL+' is '+ JSON.stringify(mkt_depth));
																														
																					let liquidity=mkt_depth[top_key]['depth']['sell'][0]['quantity'];
																					let limit_price=0;
																					
																					if(liquidity<=0) 
																					{
																							limit_price=mkt_depth[top_key]['last_price'];
																							//throw('No liquidity for '+instruments[j]['TRADE_INSTRUMENT']);
																					}
																					else
																					{
																							limit_price = mkt_depth[top_key]['depth']['sell'][0]['price'];
																					}
																					
																					if(limit_price<=0)
																					{
																						log.error('Error in getting limit price for ',zones[index]['TRADE_INSTRUMENT']);
																						await client.messages
																						  .create({
																							 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																							 body: 'In New position : Error in getting limit price for '+zones[index]['TRADE_INSTRUMENT'],
																							 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
																						   })
																						  .then(message => console.log(message.sid));
																						
																						
																					}
																					else
																					{
																						log.info('Before placing order -',zones[index]['TRADE_INSTRUMENT'],' with limit -', limit_price);
																						
																						reqd_margin= zones[index]['LOT_SIZE']*limit_price;
																						
																						//log.info('net margin -', net_margin, 'red_margin -',reqd_margin);
																						
																						if(net_margin>=reqd_margin)
																						{
																							new_order_resp = await kc.placeOrder(cfg_static['order_type'], {
																											"exchange": zones[index]['EXCHANGE'],
																											"tradingsymbol": zones[index]['TRADE_INSTRUMENT'],
																											"transaction_type": trade_type,
																											"quantity": zones[index]['LOT_SIZE'],
																											"product": cfg_static['fno_product'],
																											"order_type": "LIMIT",
																											"price":limit_price
																										});
																						 }
																						 else
																						 {
																							 log.error('Insufficient margin for -' , zones[index]['TRADE_INSTRUMENT']);
																							 new_order_resp['order_id']='dummy';
																							 await client.messages
																							  .create({
																								 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																								 body:'Insufficient margin for -' + zones[index]['TRADE_INSTRUMENT'],
																								 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
																							   });
																							 
																						 }
																					}
																			}
																 }
																else
																{
																		
																		let product_type=(zones[index]['TRADE_INSTRUMENT_TYPE']=='CASH')?cfg_static['cash_product']:cfg_static['fno_product'];
																		
																		if(product_type=='CASH')
																		{
																			reqd_margin= zones[index]['LOT_SIZE']*resp_ltp[x]['last_price'];
																		}
																		else 
																		{
																			reqd_margin = cfg_static['future_margin'];
																		}
																		
																		//log.info('net margin -', net_margin, 'red_margin -',reqd_margin);
																		
																		if(net_margin>=reqd_margin)
																		{
																		
																			log.info('Before placing order -',zones[index]['TRADE_INSTRUMENT'],' with product -', product_type);
																			
																			new_order_resp = await kc.placeOrder(cfg_static['order_type'], {
																						"exchange": zones[index]['EXCHANGE'],
																						"tradingsymbol": zones[index]['TRADE_INSTRUMENT'],
																						"transaction_type": trade_type,
																						"quantity": zones[index]['LOT_SIZE'],
																						"product": product_type,
																						"order_type": "MARKET"
																					});
																		}
																		else
																		{
																			 log.error('Insufficient margin for -' , zones[index]['TRADE_INSTRUMENT']);
																			 new_order_resp['order_id']='dummy';
																			 await client.messages
																			  .create({
																				 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																				 body:'Insufficient margin for -' + zones[index]['TRADE_INSTRUMENT'],
																				 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
																			   });
																			 
																		 }
																
																  }
																  
																  if (new_order_resp.order_id == undefined)
																  {
																	 if (!option_limit_order_exists)
																	 {
																	
																			await client.messages
																				  .create({
																					 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																					 body: 'New position  : Couldnt place order for '+zones[index]['SYMBOL'],
																					 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
																				   });
																				 

																			log.error('Couldnt place order for ',zones[index]['SYMBOL']);
																	 }
																	 
																  }
																  else
																  {
																	  risk_buffer=risk_buffer-(abs(zones[index]['STOP_LOSS']-zones[index]['ENTRY'])*zones[index]['LOT_SIZE']);
																	  
																	  await client.messages
																			  .create({
																				 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																				 body: 'New position order id  '+new_order_resp.order_id + ' for '+ zones[index]['TRADE_INSTRUMENT'],
																				 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
																			   });
																   }
																							  
																						
															}
													
													
													
													}

											}
										
									}
							  }
							 catch(e)
							 {
							 log.error('Error -',e);
							 
							 await client.messages
								  .create({
									 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
									 body: 'Critical error pls look into the logs',
									 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
								   });
								  
							 
						  }
				 }
				
				}
				else
				{
					log.info('Running outside market hours');
				}
				
		}
		catch(err)
		{
			log.error(err);
		}
		
}

function sessionHook() {
	log.info("User loggedout");
}

async function filter_existing_positions(arr_positions)
{
	
	//log.info('Config trades ',cfg_trades);
	//log.info('Arr positions', arr_positions);
	
	let filter = cfg_trades.filter(function (e) {
    return (arr_positions.indexOf(e['TRADE_INSTRUMENT'])<0);
	});
	
	
	return filter;
	
}


async function time_check(timezone, start_time, end_time)
{
			let str = (moment.tz(now, timezone).format()).split("T");
			let timecomponent=str[1].split(":");
			let timevalue=(parseInt(timecomponent[0])*60)+ parseInt(timecomponent[1]);
		//	log.info('Time value -' ,timevalue, ' Start Time -', start_time, ' End time -', end_time);
			//let running=true;
			
			if(timevalue<start_time || timevalue >end_time) 
			{
				return false;
			}
			
			return true;
	
}

async function get_position_instruments()
{
		let positions= await kc.getPositions();
		let results=positions['net'];
		let arr=[],mult_factor=1;
		var trade;
				
		for (let i=0; i<results.length; i++)
		{
				arr.push(results[i]['tradingsymbol']);
				
				if(results[i]['quantity']==0)
				{
						current_risk+=-1*results[i]['pnl'];

					
				}
				else
				{
						trade = master_trades.find(trade => trade['TRADE_INSTRUMENT']==results[i]['tradingsymbol']);
						max_positions++;
						
						if(trade == undefined)
						{
								log.error ('Catastrophe -- position not found in file for ', results[i]['tradingsymbol']);
								
							/**	await client.messages
									  .create({
										 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
										 body: 'position not found in file for '+results[i]['tradingsymbol'],
										 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
									   });**/
									   
								throw('Stop loss config missing for '+ results[i]['tradingsymbol']);
									  
								
						}
						else
						{
							log.info('Risk for -',JSON.stringify(trade));
							mult_factor=(trade['TRADE_INSTRUMENT_TYPE']== 'OPTION'?cfg_static['mult_factor']:1);
							current_risk+= Math.round(abs(((trade['STOP_LOSS']-trade['ENTRY'])*trade['LOT_SIZE'])))*mult_factor;
							
						}
				}
		}
		//log.info('Transformed array -',arr);
		
		return arr;
}


