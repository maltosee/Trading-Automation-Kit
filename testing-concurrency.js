'use strict'; 
var SimpleNodeLogger = require('simple-node-logger');

var log_opts = {
        logFilePath:'test.log',
        timestampFormat:'YYYY-MM-DD HH:mm:ss.SSS'
    };
var log = SimpleNodeLogger.createSimpleLogger( log_opts );

log.info('started -');

setTimeout(function () {
		  log.info('boo')
		}, 15000);
		
log.info('stopping -');