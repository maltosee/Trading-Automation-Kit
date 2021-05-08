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
var master_trades,cfg_trades,prev_close,gap_zones="";
//console.log('Before load config');

var config_items = require('./load_config.js');
//var sleep = require('sleep');

//console.log('after load config.. argyment '+ process.argv[2]);

const cfg_static =  new config_items(process.argv[2]);
const CSVToJSON = require('csvtojson');

//console.log('after creating cfg_static -- '+ JSON.stringify(cfg_static));
//console.log('zone file - '+cfg_static['zone_file_path']);



var err_count={},orders_placed=0, alerts_sent=false;




//console.log('after creating cfg_trades');


//const accountSid = 'ACd9e70d2f8cb3bc946caef5b4acde9117';
//const authToken = '064f1fd797bb147b91887557eedceede';
const client = require('twilio')(cfg_static['twilio_sid'], cfg_static['twilio_token']);
//const client = require('twilio')(process.env.TWILIO_ACCOUNT_SID,process.env.TWILIO_AUTH_TOKEN);
//console.log(process.env.TWILIO_ACCOUNT_SID);
//console.log(process.env.TWILIO_AUTH_TOKEN);
//const futures_margins = url.parse('https://api.kite.trade/margins/futures');


const JSONdb = require('simple-json-db');

const persist_key = dateFormat(new Date(), "yyyymmdd");
const db = new JSONdb(persist_key+".json");



var max_positions, running=true,current_risk=0;
var instruments=[], items=[], risk_buffer=0,filtered_zones=[];


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
                
                 cfg_trades= await CSVToJSON().fromFile(cfg_static['zone_file_path']);
                 prev_close = await CSVToJSON().fromFile(cfg_static['prev_close_file_path']);

                 master_trades=  await CSVToJSON().fromFile(cfg_static['master_zone_file_path']);
            
                 //await sleep(cfg_static['sleep_window']); 
				
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
				
                //log.info('Zones config - ', cfg_trades);

                //log.info('Master Zone config - ', master_trades);
            
                

				if(await time_check("Asia/Calcutta",cfg_static['start_time'],cfg_static['end_time']))
				{
				
				
						let index=0,arr_positions=[],zones=[],trade_type ='',resp_ohlc=[],symbol_arr=[];
				
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
								//let resp_ohlc=[];
                                            
                               // arr_positions = await get_position_instruments();
                            
                                zones=cfg_trades.concat();
                                
                                //log.info('Zones after copying cfg trades ',zones);
                            
                                symbol_arr = zones.map(function(item) {
                                    return cfg_static['default_exchange']+":"+item.SYMBOL;
                                });

                                resp_ohlc=await kc.getOHLC(symbol_arr);
                                let prev_cp=0, last_close={};
                                
                                for(index=0;index<zones.length;index++) /** initialize the zone gap status right at the beginning**/
                                {
                                        
                                        //prev_cp=prev_close[zones[index]['SYMBOL']]['PREV_CLOSE'];
                                    
                                       last_close = prev_close.find(prev_close => (prev_close['SYMBOL'] == zones[index]['SYMBOL']));
                                       
                                       //log.info('Last close ', last_close);
                                                                            
                                        if(last_close !=undefined)
                                        {
                                                prev_cp=last_close['PREVCLOSE'];
                                            
													if(resp_ohlc[cfg_static['default_exchange']+":"+zones[index]['SYMBOL']]['ohlc']['open']>(1+cfg_static['gap_percent'])*prev_cp)
                                                    {
                                                       
														gap_zones=gap_zones+","+zones[index]['SYMBOL'];
														 zones[index]['GAP_UP']=true;
														if((zones[index]['ENTRY']>zones[index]['TARGET'])&&(resp_ohlc[cfg_static['default_exchange']+":"+zones[index]['SYMBOL']]['ohlc']['open']>zones[index]['STOP_LOSS'])) //SELL
														{
															
															zones[index]['FAILED']=true;
															log.info('Zone failed -- ', zones[index]['TRADE_INSTRUMENT']);
														}
                                                    
													}
													else if(resp_ohlc[cfg_static['default_exchange']+":"+zones[index]['SYMBOL']]['ohlc']['open']<(1-cfg_static['gap_percent'])*prev_cp)
                                                    {
                                                        
                                                        zones[index]['GAP_DOWN']=true;
														gap_zones=gap_zones+","+zones[index]['SYMBOL'];
														
														if((zones[index]['ENTRY']<zones[index]['TARGET'])&&(resp_ohlc[cfg_static['default_exchange']+":"+zones[index]['SYMBOL']]['ohlc']['open']<zones[index]['STOP_LOSS'])) //BUY
														{
															
															zones[index]['FAILED']=true;
															log.info('Zone failed -- ', zones[index]['TRADE_INSTRUMENT']);
														}
														
                                                    
													}
													else
                                                    {
                                                       // log.info('marking no gap for ', zones[index]);
                                                        zones[index]['GAP_DOWN']=zones[index]['GAP_UP'] =false;
														zones[index]['FAILED']=false;
														
                                                    }
                                        }
                                        else
                                        {
                                            log.error('Unable to find prev close for so aborting ',zones[index]['SYMBOL']);
                                            throw('Unable to find prev close for so aborting ',zones[index]['SYMBOL']);
                                        }
                                }
								
								
							/**	for( let i = 0; i < zones.length; i++)
								{ 
    
										if ( zones[i]['FAILED'] ) { 
									
											zones.splice(i, 1); 
										}
									
								} **/
								
                            
                            
								log.info('Gap Zones for the day -- ' , gap_zones);
								log.info('Zones after removing failed one -- ', zones);
								/*await client.messages
										  .create({
											 from: 'whatsapp:'+ cfg_static['twilio_sandbox_num'],
											 body: 'Gap symbols for today -'+gap_zones,
											 to: 'whatsapp:'+ cfg_static['twilio_subscribed_num']
										   });*/
                       
                            
                                while(running)
								{
					
									 try
									 {
											
											
											current_risk=0;
											max_positions=0;
											//log.info('Config trades -'+ JSON.stringify(cfg_trades));
											
										    //log.info('before calling square off');
											arr_positions = await get_position_instruments();
											
											log.info('after calling square off , risk - ', current_risk);
											
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
										
                                            let prev_cp=0;
                                            let entry_price=0;
                                            let resp_ohlc=[];
                                            
                                            let symbol_arr = zones.map(function(item) {
                                                return cfg_static['default_exchange']+":"+item.SYMBOL;
                                            });
                                         
                                            resp_ohlc=await kc.getOHLC(symbol_arr);
                                         
                                            log.info('RESP OHLC Array - ', resp_ohlc);
                                            //let arr_gap=[];
                                         
											for (index=0; index<zones.length; index++)
											{
											
												if(db.get(persist_key+zones[index]['TRADE_INSTRUMENT']) == true)
                                                 {
                                                            
														log.error('Order already placed for the day on ' + zones[index]['TRADE_INSTRUMENT']); 
														err_count[zones[index]['TRADE_INSTRUMENT']] = true;
    
                                                  }

												if(err_count[zones[index]['TRADE_INSTRUMENT']])
												{
														log.error(zones[index]['TRADE_INSTRUMENT'] ,' already had some errors before so skipping');
												}
												else
												{
													
														if(risk_buffer>0 && !(zones[index]['FAILED']))
														{
														
																let x= cfg_static['default_exchange']+":"+zones[index]['SYMBOL'];
																log.info('Iteration - ',index.toString(),' - symbol ',JSON.stringify(zones[index]));
                                                                log.info('Look up index - ', x);
                                                                trade_type=(zones[index]['ENTRY']>zones[index]['TARGET'])?"SELL":"BUY";
																												
																//let resp_ltp = await kc.getOHLC(x);
                                                                
                                                   
																//let price_diff=abs(resp_ltp[x]['last_price']-zones[index]['ENTRY'])/zones[index]['ENTRY'];
																let ltp_within_zone=0;
																
																//prev_cp=prev_close[zones[index]['SYMBOL']];
																
																//log.info('Trade type for ' , x,' is ', trade_type, ' last price is ',resp_ltp[x]['last_price'] );
																//log.info('Zone SL - ', zones[index]['STOP_LOSS'], ' Entry ', zones[index]['ENTRY']);
																
																if(trade_type =='SELL')
																{
                                                                    entry_price=zones[index]['GAP_UP']?zones[index]['ENTRY_2']:zones[index]['ENTRY'] ;
                                                                    
                                                                  //  log.info('Symbol - ', zones[index]['SYMBOL'],'entry ',entry_price,'last close -', resp_ohlc[x]['last_price']);
                                                                    
                                                                    if((parseFloat(resp_ohlc[x]['last_price'])<parseFloat(zones[index]['STOP_LOSS']) &&(parseFloat(resp_ohlc[x]['last_price'])>=parseFloat(entry_price))))
																	{
																		ltp_within_zone=1;
																	}
                                                                    
																
                                                                }
																else
																{
                                                                    
                                                                    entry_price=zones[index]['GAP_DOWN']?zones[index]['ENTRY_2']:zones[index]['ENTRY'] ;
                                                                    
                                                                    
                                                                    
                                                                    if((parseFloat(resp_ohlc[x]['last_price'])>parseFloat(zones[index]['STOP_LOSS']) &&(parseFloat(resp_ohlc[x]['last_price'])<=parseFloat(entry_price))))
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
																	
                                                                    filtered_zones.push(zones[index]);
																	
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
																					if(arr_orders[i]['tradingsymbol']==zones[index]['TRADE_INSTRUMENT'] && arr_orders[i]['status']!='CANCELLED' )
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
																													"product": zones[index]['PROD_TYPE'],
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
																				
																				let product_type=(zones[index]['TRADE_INSTRUMENT_TYPE']=='CASH')?cfg_static['cash_product']:zones[index]['PROD_TYPE'];
																				
																				if(zones[index]['TRADE_INSTRUMENT_TYPE']=='CASH')
																				{
																					//log.info('Look up index before margin calc -',x);
                                                                                    reqd_margin= zones[index]['LOT_SIZE']*resp_ohlc[x]['last_price'];
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
																							if(arr_orders[i]['tradingsymbol']==zones[index]['TRADE_INSTRUMENT'] &&arr_orders[i]['status']!='CANCELLED' )
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
																			   db.set(persist_key+zones[index]['TRADE_INSTRUMENT'], true);


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
                                         
                                            log.info('Filtered zones where LTP hit ', filtered_zones);
                                         
									 
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
    
  
        let arr=[],mult_factor=1, trade_sl=0        ;
		var trade, config_risk, sl_config_exists=true;
        
       
       log.info('Current risk before processing holdings - ', current_risk);
    
        for (let index =0; index <holdings.length; index++)
        {
                if(holdings[index]['t1_quantity']>0 || holdings[index]['quantity']>0)
                {
                        arr.push(holdings[index]['tradingsymbol']);
                       // log.info('Assessing risk for ', holdings[index]['tradingsymbol']);
                        log.info('Processing holding - ', JSON.stringify(holdings[index]));
                    
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
								
								if(trade['STOP_LOSS']<holdings[index]['average_price']) //only if STOP LOSS is below your average price add to risk
								{
									
								
									current_risk+= (parseFloat(holdings[index]['average_price'])-parseFloat(trade['STOP_LOSS']))*lot_qty;
									log.info('Current risk after processing holdings - ',holdings[index]['tradingsymbol'],' is ', current_risk);
								}

                        }


                }
        
            
        }
    
         for (let index =0; index <positions.length; index++)
         {
                
              arr.push(positions[index]['tradingsymbol']);
              log.info('Assessing risk for ', positions[index]['tradingsymbol'],' position lot is ', positions[index]['quantity']);
              sl_config_exists=true;
              trade = master_trades.find(trade => (trade['TRADE_INSTRUMENT'] == positions[index]['tradingsymbol']));
              sl_config_exists= (trade==undefined)?false:true;
            
                           // let x =trade['EXCHANGE']+":"+trade['SYMBOL'];
                        
               log.info('Trade Config ',JSON.stringify(trade));
             //  log.info('Position:', JSON.stringify(positions[index]));

                if(positions[index]['product']==cfg_static['cash_product'] )
                {
                      //  log.info('Cash Risk'); 
                    
                    
                        if(positions[index]['quantity']>0)
                        {
                                
                                if(!sl_config_exists)
                                {
                                    
                                    log.error ('Catastrophe -- position not found in file for ', positions[index]['tradingsymbol']);
                                    throw('Stop loss config missing for -' + positions[index]['tradingsymbol']);
                                }
								
								if(trade['STOP_LOSS']<positions[index]['average_price'])
								{	
									current_risk+= (abs(parseFloat(trade['STOP_LOSS'])-parseFloat(positions[index]['average_price']))* positions[index]['quantity']);
								}	
                       
                        }
                        else if(positions[index]['quantity']==0)
                        {
                                current_risk+= -1 *positions[index]['pnl'];
                        }
                        else //squared off cash position from holdings
                        {
                            
                                if(!sl_config_exists)
                                {    
                                    log.error ('Catastrophe -- position not found in file for ', positions[index]['tradingsymbol']);
                                    throw('Stop loss config missing for -' + positions[index]['tradingsymbol']);
                                }
                            
							
								if(positions[index]['average_price']<trade['ENTRY'])
								{
									
									current_risk+= abs(parseFloat(positions[index]['average_price'])-parseFloat(trade['ENTRY']))* abs(positions[index]['quantity']); //assume that you always got stoplossed for conservative risk analysis
                            
								}
							  /** if(positions[index]['average_price']>=trade['TARGET'])
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
                                }**/

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
                                if(trade == undefined)
                                {
                                    log.error ('Catastrophe -- position not found in file for ', positions[index]['tradingsymbol']);
                                    throw('Stop loss config missing for -' + positions[index]['tradingsymbol']);

                                }

                                mult_factor = (trade['TRADE_INSTRUMENT_TYPE']=='OPTION')?cfg_static['mult_factor']:1;

                                trade_sl= abs(parseFloat(trade['STOP_LOSS'])-parseFloat(trade['ENTRY']))*abs(positions[index]['quantity'])*mult_factor;
								let m2m= Math.max(trade_sl, -1*positions[index]['pnl']);

                              //  log.info('Trade SL - ',trade_sl);
							  
								if(trade['TRADE_INSTRUMENT_TYPE']=='OPTION')
								{
									let premium_loss= cfg_static['premium_loss_percent']*positions[index]['average_price']*abs(positions[index]['quantity']);
									current_risk+=Math.min(premium_loss,m2m);
									
									log.info('Option trade trade_sl is ' , trade_sl, ' premium_risk is ', premium_loss, 'm2m is ', m2m);

								}
							    else 
                                {
                                    current_risk+=Math.max(trade_sl, -1 *positions[index]['pnl']);
                                }
                              

                              /**  if(positions[index]['pnl']<0) //sometimes the FNO position loss can exceed the SL
                                {
                                    if(trade['STOP_LOSS']>trade['ENTRY']) // add risk only SL not hit yet
                                    {
                                        current_risk+= Math.max(trade_sl, -1 *positions[index]['pnl']);
                                    }
                                }
                                else
                                {

                                    if(trade['STOP_LOSS']<trade['ENTRY']) // add risk only SL not hit yet
                                    {
                                        current_risk+=Math.max(trade_sl, -1 *positions[index]['pnl']);
                                    }
                                } **/

                        }

                }

                             //log.info('Current Risk is now ',current_risk);  

                    

        }
   
		return arr;
}


