"use strict";
var KiteConnect = require("kiteconnect").KiteConnect;
//var KiteTicker = require("kiteconnect").KiteTicker;
var SimpleNodeLogger = require('simple-node-logger');
const fs = require('fs');
var dateFormat = require('dateformat');
var abs = require( 'math-abs' );


var config_items = require('./load_config.js');
const cfg_trades= new config_items('./zones.json');
const cfg_static =  new config_items('./config.json');
var max_positions;

var options = {
	"api_key": cfg_static['api_key'],
	"debug": false
};

let date_string = dateFormat(new Date(), "yyyymmddhhmmss")+"-fnoautomate-.log";
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
			let index=0,arr_positions=[],zones=[],trade_type ='',order_resp={};
			
			while(true)
			{
				
				 try
				 {
						current_risk=0;
						max_positions=0;
						//log.info('Config trades -'+ JSON.stringify(cfg_trades));
						
						arr_positions = await square_off_tgt_sl();
						
						if(max_positions>cfg_static['max_positions'])
						{
							throw('Max positions for the day.. skipping everything');
						}
						
	
	//					arr_positions = await get_position_instruments();
						
					//	log.info('Existing positions -', arr_positions);
						
						risk_buffer= cfg_static['max_risk']-current_risk;
						
							
						zones = await filter_existing_positions(arr_positions);
						//log.info('Zones -',zones);
						//log.info('Current risk :', current_risk, ' Risk Buffer :', risk_buffer);
						
						let arr_orders = await kc.getOrders();
						
						for (index=0; index<zones.length; index++)
						{
								
							if(risk_buffer>0)
							{
									
									let x= "NSE:"+zones[index]['SYMBOL'];
									//log.info('Iteration - ',index.toString(),' - symbol ',x,' Zone -', zones[index]['ZONE']);
									
									
									let resp_ltp = await kc.getLTP(x);
									//log.info('LTP - ',resp_ltp[x]);
									
									
									let price_diff=abs(resp_ltp[x]['last_price']-zones[index]['ENTRY'])/zones[index]['ENTRY'];
									let ltp_within_zone=0;
									
									trade_type=(zones[index]['ENTRY']>zones[index]['TARGET'])?"SELL":"BUY";
									
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
										let option_limit_order_exists=false;
									
										log.info('filtered zone ', zones[index]);
										
										let order_risk= abs(zones[index]['ENTRY']-zones[index]['STOP_LOSS']);
									
										if(order_risk>(cfg_static['max_risk']-current_risk))
										{
											log.error('Order risk for zone -',zones['SYMBOL'],' exceeds risk buffer');
										}
										else // place order
										{
											if(zones[index]['TRADE_INSTRUMENT_TYPE'] == 'OPTION')
											{
													let top_key=zones[index]['EXCHANGE']+":"+zones[index]['TRADE_INSTRUMENT'];
										
													/** check order history for the day**/
													for (let i=0; i< arr_orders.length; i++)
													{
														if(arr_orders[i]['tradingsymbol']==zones[index]['TRADE_INSTRUMENT'])
														{
															if(arr_orders[i]['status']=='OPEN' || arr_orders[i]['status']=='AMO REQ RECEIVED')
															{
																log.info('Pending order already exists for ', top_key);
																option_limit_order_exists=true;
															}
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
																	log.error('Error in getting LTP for ',zones[index]['TRADE_INSTRUMENT']);
																}
																
																log.info('Before placing order -',zones[index]['TRADE_INSTRUMENT'],' with limit -', limit_price);
																order_resp = await kc.placeOrder(cfg_static['order_type'], {
																				"exchange": zones[index]['EXCHANGE'],
																				"tradingsymbol": zones[index]['TRADE_INSTRUMENT'],
																				"transaction_type": trade_type,
																				"quantity": zones[index]['LOT_SIZE'],
																				"product": "NRML",
																				"order_type": "LIMIT",
																				"price":limit_price
																			});
														}
											 }
											 else
											 {
													order_resp = await kc.placeOrder(cfg_static['order_type'], {
																"exchange": zones[index]['EXCHANGE'],
																"tradingsymbol": zones[index]['TRADE_INSTRUMENT'],
																"transaction_type": trade_type,
																"quantity": zones[index]['LOT_SIZE'],
																"product": "NRML",
																"order_type": "MARKET"
															});
											
											  }
											  
											  if (!order_resp.order_id)
											  {
												throw('Couldnt place order for '+zones[index]['SYMBOL']);
											  }
											  else
											  {
												  risk_buffer=risk_buffer-(abs(zones[index]['STOP_LOSS']-zones[index]['ENTRY'])*zones[index]['LOT_SIZE']);
											  }
											  
										
										}
									
									
									
								   }

							}
							
						}
				  }
				  catch(e)
				  {
					 log.error('Error -',e);
					 
				  }
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

async function get_position_instruments()
{
		let positions= await kc.getPositions();
		let results=positions['net'];
		let arr=[],trade={},mult_factor=1;
		
				
		for (let i=0; i<results.length; i++)
		{
				arr.push(results[i]['tradingsymbol']);
				
				if(results[i]['quantity']==0)
				{
					current_risk+=results[i]['pnl'];
					
				}
				else
				{
					trade = cfg_trades.find(el => el['trade_instrument']==results[i]['tradingsymbol']);
					
					mult_factor=(trade['TRADE_INSTRUMENT_TYPE']== 'OPTION'?cfg_static['mult_factor']:1);
					
					current_risk+= Math.round(abs(((trade['STOP_LOSS']-trade['ENTRY'])*trade['LOT_SIZE'])))*mult_factor;
				}
		}
		//log.info('Transformed array -',arr);
		
		return arr;
}

async function square_off_tgt_sl()
{
	let positions= await kc.getPositions();
	let results=positions['net'];
	
	let arr_orders = await kc.getOrders();
	
	var trade, sl_hit=0, tgt_hit=0, sl_readjust=0,orders_resp={}, arr=[],mult_factor=1, trans_type;
	
	for (let index =0; index <results.length; index++)
	 {
			arr.push(results[index]['tradingsymbol']); //one trading symbol to be traded only once a day
			
			//log.info('Current risk before processing position -',results[index]['tradingsymbol'], ' is ',current_risk);
			
			if(results[index]['quantity']!=0)
			{
					//log.info('Searching for trading instrument in json config -',JSON.stringify(cfg_trades));
					trade = cfg_trades.find(trade => (trade['TRADE_INSTRUMENT'] == results[index]['tradingsymbol']));
					
					if(trade == undefined)
					{
						throw('Catastrophe -- position not found in file for '+results[index]['tradingsymbol']);
					}
					
					
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
											throw('Error in getting LTP for '+instruments[0]['TRADE_INSTRUMENT']);
									}
									
									order_resp = await kc.placeOrder(cfg_static['ORDER_TYPE'], {
												"exchange": trade['EXCHANGE'],
												"tradingsymbol": trade['TRADE_INSTRUMENT'],
												"transaction_type": "SELL", // always SELL the option as square off
												"quantity": trade['LOT_SIZE'],
												"product": "NRML",
												"order_type": "LIMIT",
												"price":limit_price
											});
												
												
						}
						else
						{
							 
							 let sqoff_type=(trade['ENTRY']>trade['TARGET'])?"BUY":"SELL";// reverse logic of place order
							 log.info('Before calling place order for -',trade['SYMBOL']);
							//let pc=new Order_place(params);
							 order_resp = await kc.placeOrder(cfg_static['ORDER_TYPE'], {
											"exchange": trade['EXCHANGE'],
											"tradingsymbol": trade['TRADE_INSTRUMENT'],
											"transaction_type":sqoff_type,
											"quantity": trade['LOT_SIZE'],
											"product": "NRML",
											"order_type": "MARKET"
										});
							 
						 }
					
				
						if (!order_resp.order_id)
						{
							log.error('Couldnt place order for '+trade['SYMBOL']);
						}
				
				}
				else
				{
					max_positions++;
				}
			
			
			}
			else
			{
				current_risk+=-1*results[index]['pnl'];
				
			}
	 
	 }
	
	return arr;
}

