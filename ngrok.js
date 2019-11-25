'use strict';
var KiteConnect = require("kiteconnect").KiteConnect;
var KiteTicker = require("kiteconnect").KiteTicker;
var SimpleNodeLogger = require('simple-node-logger');
var abs = require( 'math-abs' );
//var config_entries=[[738561,100,100,100], [779521,100,100,100]]; //array of 
//vr obj = csv(); 
//const csvdata = require('csvdata');
const fs = require('fs');
const orders_placed=[];
var lockFile1 = require("lockfile");
const lockfile="some-file.lock";


function onTicks(ticks) {
	//console.log("Ticks", ticks);
	
		log.info("Ticks  -",ticks);
		handle_tick(ticks).then(function(resp){log.info('Orders placed-',resp)}).catch(function(err){log.error(err)});
	
}


function subscribe() {
	var items = [340481,256265,12644866,779521];
	console.log("in subscribe");
	ticker.subscribe(items);
	ticker.setMode(ticker.modeLTP, items);
}

function order_details(data) {
	//console.log("Entered Order_details");
	//log.info("Order_details", data);
	log.info("Order Details -",data);
}

/**function process_tick(ticks){
   
   //split tick into three portions
   //ticks1, ticks2, ticks 3
   
  // var i= Math.floor(ticks.length/2);
   

   
  // handle_tick(ticks.slice(i)).then(log.info('Orders placed-',arr)).catch(log.error(err));
   //handle_tick(ticks.slice(0,i)).then(log.info('Orders placed-',arr)).catch(log.error(err));
   
      
};**/

var handle_tick =  function(ticks){

  return new Promise((resolve,reject)=>{
	  //do something with tick object for now just print
	  //check for lock
	  
	  
	  try
	  {
		if (lockFile1.checkSync(lockfile)) return;// --> lock check do nothing
		lockFile1.lockSync(lockfile);//lock  
		  
		  var newArray =[];
		  var price_diff=0;
		  
		  
		  for(var i=0; i<ticks.length - 1; i++)
		   {
			   
			  if (orders_placed.indexOf(ticks[i].instrument_token)==-1) // order not already placed
			  {
				
				 newArray=[];
				 newArray = instruments.filter(function (el) {
								return el.TOKEN == ticks[i].instrument_token;
									});
			  
				  if (newArray.length) 
					{
				
					  log.info('Checking for -',newArray[0]);
					  let price_diff=abs(ticks[i]['last_price'] - newArray[0]['ENTRY'])/(ticks[i]['last_price']);
					  log.info('price diff -',price_diff);
					  
						if(price_diff<=0.015) //1.5%
						{
							log.info(" before Place order for -",newArray[0]['SYMBOL']);
							//orders_placed.push(ticks[i]['instrument_token']);
							kc.placeOrder("regular", {
								"exchange": "NSE",
								"tradingsymbol": newArray[0]['SYMBOL'],
								"transaction_type": newArray[0]['TYPE'],
								"quantity": newArray[0]['LOT'],
								"product": "NRML",
								"price": newArray[0]['ENTRY'],
								"order_type": "LIMIT",
								"tag":"API"
							}).then(function(resp) {
								log.info('Placed order for -',resp);
								log.info('checking instrument - ',ticks[i]['instrument_token']);
								orders_placed.push(ticks[i]['instrument_token']);
							}).catch(function(err) {
								log.error('Failed to log order  - ',err);
							});
						}
												
						   
					}
				  
		      }
			   
		   }
		   resolve(orders_placed);
		   lockFile1.unlockSync('some-file.lock');//unlock
	  }
	  catch(e)
	  {
		 log.error('In catch block');
		 if (lockFile1.checkSync(lockfile)) {lockFile1.unlockSync('some-file.lock');}//unlock
		 return reject(e);
		  
	  }
	  	  
  });
}
	


function regularOrderPlace(variety,symbol) {
	kc.placeOrder(variety, {
			"exchange": "NFO",
			"tradingsymbol": symbol,
			"transaction_type": "BUY",
			"quantity": 1,
			"product": "MIS",
			"order_type": "MARKET"
		}).then(function(resp) {
			console.log(resp);
		}).catch(function(err) {
			console.log(err);
		});
}



function init() {
	console.log(kc.getLoginURL());
	getProfile();
    getMargins();
//	getMargins("equity");
	getPositions();
//	getHoldings();
	//invalidateAccessToken();
}


function sessionHook() {
	console.log("User loggedout");
}

function getProfile() {
	kc.getProfile()
		.then(function(response) {
			console.log(response)
		}).catch(function(err) {
			console.log(err);
		});
}

function getMargins(segment) {
	kc.getMargins(segment)
		.then(function(response) {
			console.log(response);
		}).catch(function(err) {
			console.log(err);
		});
}

function getPositions() {
	kc.getPositions()
		.then(function(response) {
			console.log(response);
		}).catch(function(err) {
			console.log(err);
		});
}



//Login automation

var api_key = "chwh6abfx02v61id",
	secret = "mmqmv4meadot1lzypq5son13kqk0cbgd",
	request_token = "4FcQr60A23yCbjCUTUzOBQJfd3jRcM15",
	access_token = "";

var options = {
	"api_key": api_key,
	"debug": false
};

var log_opts = {
        logFilePath:'mylogfile.log',
        timestampFormat:'YYYY-MM-DD HH:mm:ss.SSS'
    };
var log = SimpleNodeLogger.createSimpleLogger( log_opts );


//csvdata.load('./to-be-placed.csv', {objName: 'name'});
let rawdata = fs.readFileSync('instruments.json');
const instruments = JSON.parse(rawdata);
//log.info('Loading instrument data -',instruments);
//log.info('First instrument-',instruments[0]['SYMBOL']);

var kc = new KiteConnect(options);
kc.setSessionExpiryHook(sessionHook);

if(!access_token) {
	//console.log("before generateSession");
	log.info("Before session generation");
	kc.generateSession(request_token, secret)
		.then(function(response) {
			console.log("Response", response);
			init();
		})
		.catch(function(err) {
			log.error("Error in session generation",err);
			console.log(err);
			
		})
} else {
	kc.setAccessToken(access_token);
	init();
}


var ticker = new KiteTicker({
	api_key: api_key,
	access_token: access_token
});

/** arrive at instruments already been traded for today and exclude from subscription 



**/

// set autoreconnect with 10 maximum reconnections and 5 second interval
//ticker.autoReconnect(true, 10, 5)
ticker.on("ticks", onTicks);
ticker.on("connect", subscribe);
ticker.on("order_update",order_details);
ticker.connect();
//console.log("before order listen");
log.info("before orderlisten");


ticker.on("noreconnect", function() {
	console.log("noreconnect");
});

ticker.on("reconnecting", function(reconnect_interval, reconnections) {
	console.log("Reconnecting: attempt - ", reconnections, " interval - ", reconnect_interval);
});

/*setTimeout(()=>{
    console.log("disconnect");
    ticker.unsubscribe([738561]);
    ticker.disconnect();
},5000);*/
