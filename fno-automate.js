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
//var sleep = require('sleep');

//console.log('after load config.. argyment '+ process.argv[2]);

const cfg_static =  new config_items(process.argv[2]);

//console.log('after creating cfg_static -- '+ JSON.stringify(cfg_static));
//console.log('zone file -'+cfg_static['zone_file_path']);

const cfg_trades= new config_items(cfg_static['zone_file_path']);

const master_trades= new config_items(cfg_static['master_zone_file_path']);

var err_count={},orders_placed=0, alerts_sent=false;

//console.log('after creating cfg_trades');


//const accountSid = 'ACd9e70d2f8cb3bc946caef5b4acde9117';
//const authToken = '064f1fd797bb147b91887557eedceede';
const client = require('twilio')(cfg_static['twilio_sid'], cfg_static['twilio_token']);
//const client = require('twilio')(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN);
//console.log(process.env.TWILIO_ACCOUNT_SID);
//console.log(process.env.TWILIO_AUTH_TOKEN);
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
				
				for (let x=0; x<cfg_trades.length; x++)
				{
					err_count[cfg_trades[x]['TRADE_INSTRUMENT']]=false;
				}
				
				if(await time_check("Asia/Calcutta",cfg_static['start_time'],cfg_static['end_time']))
				{
				
				
						let index=0,arr_positions=[],zones=[],trade_type ='';
				
						if(orders_placed>cfg_static['max_orders_per_run'])
						{
							
								log.error('More than ',cfg_static['max_orders_per_run'],' orders have already been placed so idling away');
								
								if(!alerts_sent)
								{
									await client.messages
										  .create({
											 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
											 body:'More than '+cfg_static['max_orders_per_run']+' orders have already been placed so idling away',
											 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
										   });
										   
									alerts_sent=true;
								}
							
						}
						else
						{
								while(running)
								{
					
									 try
									 {
											
											
											current_risk=0;
											max_positions=0;
											//log.info('Config trades -'+ JSON.stringify(cfg_trades));
											
										    //log.info('before calling square off');
											arr_positions = await get_position_instruments();
											
											log.info('after calling square off , risk -', current_risk);
											
											if(max_positions>cfg_static['max_positions'])
											{
												throw('Max positions for the day.. skipping everything');
											}
											
											if(orders_placed>cfg_static['max_orders_per_run'])
											{
												throw('More than ',cfg_static['max_orders_per_run'],' orders have already been placed so idling away');
									
											}
											
											let arr_orders = await kc.getOrders();
						
											if(arr_orders.length>cfg_static['max_orders_per_day'])
											{
													throw('Max orders exceeded for the day');
													//return arr;
											}
											
											risk_buffer= cfg_static['max_risk']-current_risk;
                                         
                                            log.info('Risk Buffer - ', risk_buffer);
										  //risk_buffer=20000;
                                         
											if(arr_positions.length)
                                            {
											     zones = await filter_existing_positions(arr_positions);
                                            }
											
											for (index=0; index<zones.length; index++)
											{
												
												if(err_count[zones[index]['TRADE_INSTRUMENT']])
												{
														log.error(zones[index]['TRADE_INSTRUMENT'] ,' already had some errors before so skipping');
												}
												else
												{
													
														if(risk_buffer>0)
														{
														
																let x= cfg_static['default_exchange']+":"+zones[index]['SYMBOL'];
																log.info('Iteration - ',index.toString(),' - symbol ',x,' Zone -', zones[index]['ZONE']);
																												
																let resp_ltp = await kc.getLTP(x);
															
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
																
																	let option_limit_order_exists=false, new_order_resp={},future_limit_order_exists=false;
																	let user_margin_response={};
																	let net_margin=0, reqd_margin=0;
																	
																	log.info('filtered zone ', JSON.stringify(zones[index]));
																	
																	
																	let order_risk= abs(zones[index]['ENTRY']-zones[index]['STOP_LOSS'])*zones[index]['LOT_SIZE'];
																
																	if(order_risk>risk_buffer)
																	{
																		log.error('Order risk for zone -',zones['SYMBOL'],' exceeds risk buffer -', risk_buffer);
																		risk_buffer=risk_buffer-(abs(zones[index]['STOP_LOSS']-zones[index]['ENTRY'])*zones[index]['LOT_SIZE']);
																			  
																		err_count[zones[index]['TRADE_INSTRUMENT']]= true;
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
																		
																	
																		if(net_margin <=0)
																		{
																			err_count[zones[index]['TRADE_INSTRUMENT']]= true;
																			//throw('Cant fetch margin for '+ zones[index]['TRADE_INSTRUMENT']);
																			
																			await client.messages
																					  .create({
																						 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																						 body: 'No margin for new position in '+ zones[index]['TRADE_INSTRUMENT'],
																						 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
																					   })
																					  .then(message => console.log(message.sid));
																			
																		}
																		
																		
																		if(zones[index]['TRADE_INSTRUMENT_TYPE'] == 'OPTION')
																		{
																				
																				let top_key=zones[index]['EXCHANGE']+":"+zones[index]['TRADE_INSTRUMENT'];
																	
																				/** check order history for the day**/
																				for (let i=0; i< arr_orders.length; i++)
																				{
																					if(arr_orders[i]['tradingsymbol']==zones[index]['TRADE_INSTRUMENT'])
																					{

																							log.error('Pending order already exists for ', top_key);
																							option_limit_order_exists=true;
			
																							 err_count[zones[index]['TRADE_INSTRUMENT']]= true;
																							 
																							 
																					}
																				 }
																				 
																				 if(option_limit_order_exists)
																				 {
																					 await client.messages
																					  .create({
																						 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																						 body: 'New Position : Pending order already exists for '+ top_key,
																						 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
																					   })
																					  .then(message => console.log(message.sid));
																					
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
																									
																									err_count[zones[index]['TRADE_INSTRUMENT']]= true;
																									
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
																													"transaction_type": "BUY",
																													"quantity": zones[index]['LOT_SIZE'],
																													"product": cfg_static['fno_product'],
																													"order_type": "LIMIT",
																													"price":limit_price
																												});
																												
																									 orders_placed++;
																								 }
																								 else
																								 {
																									 log.error('Insufficient margin for -' , zones[index]['TRADE_INSTRUMENT']);
																									 new_order_resp['order_id']='dummy';
																									 
																									 err_count[zones[index]['TRADE_INSTRUMENT']]= true;
																									 
																									 await client.messages
																									  .create({
																										 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																										 body:'Insufficient margin for -' + zones[index]['TRADE_INSTRUMENT'],
																										 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
																									   });
																									 
																								 }
																							}
																					}
																					else
																					{
																						await client.messages
																							  .create({
																								 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																								 body: 'Taking new position : Pending  order already exists for ' + zones[index]['TRADE_INSTRUMENT'],
																								 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
																							   });
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
																					
																					/** check order history for the day**/
																						for (let i=0; i< arr_orders.length; i++)
																						{
																							if(arr_orders[i]['tradingsymbol']==zones[index]['TRADE_INSTRUMENT'])
																							{

																									log.info('Pending future order already exists for ', zones[index]['TRADE_INSTRUMENT']);
																									future_limit_order_exists=true;
																									
																									err_count[zones[index]['TRADE_INSTRUMENT']]= true;
					
																									  
																							}
																						 }
																						 
																						 if(future_limit_order_exists)
																						 {
																							 await client.messages
																								  .create({
																									 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																									 body: 'New Position : Pending order already exists for '+ zones[index]['TRADE_INSTRUMENT'],
																									 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
																								   })
																								  .then(message => console.log(message.sid));
																						 }
																						 else
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
																										
																								orders_placed++;
																								
																						  }
																				
																				}
																				else
																				{
																					 log.error('Insufficient margin for -' , zones[index]['TRADE_INSTRUMENT']);
																					 new_order_resp['order_id']='dummy';
																					 
																					 err_count[zones[index]['TRADE_INSTRUMENT']]= true;
																					 
																					 await client.messages
																					  .create({
																						 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																						 body:'In new Position :Insufficient margin for -' + zones[index]['TRADE_INSTRUMENT'],
																						 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
																					   });
																					 
																				 }
																		
																		  }
																		  
																		  if (new_order_resp.order_id == undefined)
																		  {
																				if (!option_limit_order_exists && !future_limit_order_exists)
																				 {
																						err_count[zones[index]['TRADE_INSTRUMENT']]= true;
																						
																						await client.messages
																							  .create({
																								 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
																								 body: 'New position  : Couldnt place order for '+zones[index]['TRADE_INSTRUMENT'],
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
												        //await sleep(500);
                                                        
												}
											}
									 
									 }
									 catch(e)
									 {
											log.error('Error -',e);
											
											if(!alerts_sent)
											{
												await client.messages
												  .create({
													 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
													 body: 'in new position -'+ JSON.stringify(e),
													 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
												   });
												 alerts_sent=true;
											}
											 
									 }
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
        let holdings=await kc.getHoldings();
		let position_arr= await kc.getPositions();
        let positions=position_arr['net'];
    
  
        let arr=[],mult_factor=1;
		var trade, config_risk;
        
       // log.info('Holdings - ', JSON.stringify(holdings));
       // log.info('Positions - ', JSON.stringify(positions));
    
        for (let index =0; index <holdings.length; index++)
        {
                if(holdings[index]['t1_quantity']>0 || holdings[index]['quantity']>0)
                {
                        arr.push(holdings[index]['tradingsymbol']);
                       // log.info('Assessing risk for ', holdings[index]['tradingsymbol']);
                    
                        trade = master_trades.find(trade => (trade['TRADE_INSTRUMENT'] == holdings[index]['tradingsymbol']));

                        if(trade == undefined)
                        {
                                log.error ('Catastrophe -- position not found in file for ', holdings[index]['tradingsymbol']);

                                //err_count[results[index]['tradingsymbol']]= true;

                                throw('Stop loss config missing for -' + holdings[index]['tradingsymbol']);

                        }
                        else
                        {
                                //let x =trade['EXCHANGE']+":"+trade['SYMBOL'];
                                let lot_qty= Math.max(holdings[index]['t1_quantity'],holdings[index]['quantity']);
                                current_risk+=(parseFloat(trade['STOP_LOSS'])-parseFloat(holdings[index]['average_price']))*lot_qty;

                        }


                }
        
            
        }
    
         for (let index =0; index <positions.length; index++)
         {
                
              arr.push(positions[index]['tradingsymbol']);
              //log.info('Assessing risk for ', positions[index]['tradingsymbol']);
              trade = master_trades.find(trade => (trade['TRADE_INSTRUMENT'] == positions[index]['tradingsymbol']));
            
                    if(trade == undefined)
                    {
                                log.error ('Catastrophe -- position not found in file for ', positions[index]['tradingsymbol']);

                                //err_count[results[index]['tradingsymbol']]= true;

                                throw('Stop loss config missing for -' + positions[index]['tradingsymbol']);

                    }
                    else
                    {
                               // let x =trade['EXCHANGE']+":"+trade['SYMBOL'];
                        
                               // log.info('Trade config ',JSON.stringify(trade));
                               // log.info('Position:', JSON.stringify(positions[index]));
                        
                                if(positions[index]['product']==cfg_static['cash_product'] )
                                {
                                      //  log.info('Cash Risk');    
                                        if(positions[index]['quantity']>0)
                                        {
                                                current_risk+= (abs(parseFloat(trade['STOP_LOSS'])-parseFloat(positions[index]['average_price']))* positions[index]['quantity']);
                                        }
                                        else if(positions[index]['quantity']==0)
                                        {
                                            current_risk+= -1 *positions[index]['pnl'];
                                        }
                                        else
                                        {
                                            if(positions[index]['average_price']>=trade['TARGET'])
                                            {
                                                    current_risk+= abs(parseFloat(trade['TARGET'])-parseFloat(positions[index]['average_price']))*positions[index]['quantity'];
                                            }
                                            else if (positions[index]['average_price']<=trade['STOP_LOSS'])
                                            {
                                                     current_risk+= abs(parseFloat(trade['STOP_LOSS'])-parseFloat(positions[index]['average_price']))*abs(positions[index]['quantity']);
                                            }
                                            else
                                            {
                                                log.error('Square off price not in between TGT and SL for ',positions[index]['tradingsymbol']);
                                            }

                                        }
                                    
                                    
                                }
                                else
                                {
                                        //log.info('FNO risk');
                                        if(positions[index]['quantity']==0)
                                        {
                                            current_risk+= -1 *positions[index]['pnl'];
                                        }
                                        else
                                        {
                                            current_risk+= abs(parseFloat(trade['STOP_LOSS'])-parseFloat(positions[index]['average_price']))*abs(positions[index]['quantity']);
                                        }
                                        
                                }

                             //log.info('Current Risk is now ',current_risk);  

                    }

        }
   
		return arr;
}


