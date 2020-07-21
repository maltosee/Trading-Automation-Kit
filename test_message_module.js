"use strict";

var pub_sms=require("./send_sms/sns_publishsms.js");



var msg_params = {
					  Message: 'Testing', 
					  PhoneNumber:'+919972107070',
					  MessageAttributes: {
								'AWS.SNS.SMS.SMSType': {
									'DataType': 'String',
									'StringValue': 'Transactional'
														}
										}
					};
					
var msg_send = new pub_sms();

msg_send.publish_message(msg_params);

