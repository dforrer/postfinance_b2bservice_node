const https = require('https');

/**
 * Generic https-request with options and a callback function
 * @param url           String
 * @param options       JS object
 * @param request       String
 * @param callback      JS function
 * @return (nothing)
 */
function post_request( url, options, request, callback ) {
    const req = https.request(url, options, res => {
        res.setEncoding('utf8');
        let body = '';
        res.on('data', chunk => {
            body += chunk;
        });
        res.on('end', d => {
            res.response = body;
            callback(res);
        });
    });

    req.on('error', error => {
        let res = {
            error: error
        };
        callback(res);
    });

    req.on('timeout', () => {
        req.destroy();
        let res = {
            error: 'HTTPS-Connection timed out.'
        };
        callback(res);
    });

    req.write(request);
    req.end();
}

/**
 * This function calls the 'GetInvoiceListPayer' method of the webservice.
 * @param username          String
 * @param pw                String
 * @param nonce             String
 * @param timestamp         String, e.g. 2022-07-06T06:35:44.157Z
 * @param ebill_account_id	String
 * @param archive_data      boolean (true, false)
 * @param soap_url          String
 * @param reject_unauthorized boolean (true, false)
 * @param cert              String
 * @param callback          Function
 * @return (nothing)
 */

exports.pf_getInvoiceListPayer = function (username, pw, nonce, timestamp, ebill_account_id, archive_data, soap_url, reject_unauthorized, cert, callback) {
	var soap_request = 	'<soap:Envelope xmlns:ch="http://ch.swisspost.ebill.b2bservice" xmlns:soap="http://www.w3.org/2003/05/soap-envelope">' +
							'<soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">' +
								'<wsse:Security soap:mustUnderstand="true" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">' +
									'<wsse:UsernameToken>' +
										'<wsse:Username>' + username + '</wsse:Username>' +
										'<wsse:Password>' + pw + '</wsse:Password>' +
										'<wsse:Nonce>' + nonce + '</wsse:Nonce>' +
										'<wsu:Created>' + timestamp + '</wsu:Created>' +
									'</wsse:UsernameToken>' +
								'</wsse:Security>' +
								'<wsa:Action>http://ch.swisspost.ebill.b2bservice/B2BService/GetInvoiceListPayer</wsa:Action>' +
							'</soap:Header>' +
							'<soap:Body>' +
								'<ch:GetInvoiceListPayer>' +
									'<ch:eBillAccountID>' + ebill_account_id + '</ch:eBillAccountID>' +
									'<ch:ArchiveData>' + archive_data + '</ch:ArchiveData>' +
								'</ch:GetInvoiceListPayer>' +
							'</soap:Body>' +
						'</soap:Envelope>';

    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/soap+xml;charset=UTF-8;action="http://ch.swisspost.ebill.b2bservice/B2BService/GetInvoiceListPayer"',
            'Content-Length': Buffer.byteLength(soap_request),
            'SOAPAction': 'http://ch.swisspost.ebill.b2bservice/B2BService/GetInvoiceListPayer'
        },
        cert: cert,
        rejectUnauthorized: reject_unauthorized,
        timeout: 30000
    };

    post_request(soap_url, options, soap_request, callback);
}

/**
 * This function calls the 'GetInvoicePayer' method of the webservice.
 * @param username          String
 * @param pw                String
 * @param nonce             String
 * @param timestamp         String, e.g. 2022-07-06T06:35:44.157Z
 * @param ebill_account_id	String
 * @param biller_id         String
 * @param transaction_id	String
 * @param file_type         String, e.g. PDF, RGXMLSIG, EDIFACT, ZIP
 * @param soap_url          String
 * @param reject_unauthorized boolean (true, false)
 * @param cert              String
 * @param callback          Function
 * @return (nothing)
 */

exports.pf_getInvoicePayer = function (username, pw, nonce, timestamp, ebill_account_id, biller_id, transaction_id, file_type, soap_url, reject_unauthorized, cert, callback) {
	var soap_request = 	'<soap:Envelope xmlns:ch="http://ch.swisspost.ebill.b2bservice" xmlns:soap="http://www.w3.org/2003/05/soap-envelope">' +
							'<soap:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">' +
								'<wsse:Security soap:mustUnderstand="true" xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">' +
									'<wsse:UsernameToken>' +
										'<wsse:Username>' + username + '</wsse:Username>' +
										'<wsse:Password>' + pw + '</wsse:Password>' +
										'<wsse:Nonce>' + nonce + '</wsse:Nonce>' +
										'<wsu:Created>' + timestamp + '</wsu:Created>' +
									'</wsse:UsernameToken>' +
								'</wsse:Security>' +
								'<wsa:Action>http://ch.swisspost.ebill.b2bservice/B2BService/GetInvoicePayer</wsa:Action>' +
							'</soap:Header>' +
							'<soap:Body>' +
								'<ch:GetInvoicePayer>' +
									'<ch:eBillAccountID>' + ebill_account_id + '</ch:eBillAccountID>' +
									'<ch:BillerID>' + biller_id + '</ch:BillerID>' +
                                    '<ch:TransactionID>' + transaction_id + '</ch:TransactionID>' +
                                    '<ch:FileType>' + file_type + '</ch:FileType>' +
								'</ch:GetInvoicePayer>' +
							'</soap:Body>' +
						'</soap:Envelope>';

    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/soap+xml;charset=UTF-8;action="http://ch.swisspost.ebill.b2bservice/B2BService/GetInvoicePayer"',
            'Content-Length': Buffer.byteLength(soap_request),
            'SOAPAction': 'http://ch.swisspost.ebill.b2bservice/B2BService/GetInvoicePayer'
        },
        cert: cert,
        rejectUnauthorized: reject_unauthorized,
        timeout: 30000
    };

    post_request(soap_url, options, soap_request, callback);
}
