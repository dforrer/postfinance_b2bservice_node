//*****************************************************************************
// DOCUMENTATION
// =============
// Information about the Postfinance webservice:
// https://www.postfinance.ch/content/dam/pfch/doc/460_479/460_109_en.pdf
//
// WSDL: https://ebill-ki.postfinance.ch/B2BService/B2BService.svc?singleWsdl
//
// Requirements/Setup
// -------------------
// - Node.js and NPM have to be installed
// - Copy the contents of this repository into your working directory
// - Install the node-modules with:
//   $ npm install
// - Enter valid Postfinance credentials in 'pf_config_TEST.json':
//    > Username (pf_user)
//    > Password (pf_pw)
//    > eBill-AccountID (pf_eBillAccountID)
// - Run the app:
//   $ node pf_get_invoices.js
//
// Program sequence overview
// --------------------------
// - Download the list of new invoices from the Postfinance webservice
// - Download the XML and PDF file for every TransactionID, BillerID, FileType
//
// Function invocation
// --------------------
// 1. getInvoiceListPayer(): 1x
// 1.1. pf_getInvoiceListPayer(): 1x
// 2. parseInvoiceListPayer(): 1x
// 3. processNextInvoice(): While Array 'invoices' has entries
// 4. getInvoicePayer(): While Array 'invoices' has entries
// 4.1. pf_getInvoicePayer(): While Array 'invoices' has entries
//*****************************************************************************

//*****************************************************************************
// Load node.js modules
//*****************************************************************************
const fs = require('fs');
const util = require('util');
const crypto = require('crypto');
const parseString = require('xml2js').parseString;

//*****************************************************************************
// Load custom modules
//*****************************************************************************
const pf_ws = require('./pf_webservices.js')

//*****************************************************************************
// Open application specific configuration and mappings
//*****************************************************************************
global.config = require('./pf_config_TEST.json')

//*****************************************************************************
// Create directories if they don't exist already
//*****************************************************************************
if (!fs.existsSync(config['dir_logs'])) {
    fs.mkdirSync(config['dir_logs']);
}
if (!fs.existsSync(config['dir_lists'])) {
    fs.mkdirSync(config['dir_lists']);
}
if (!fs.existsSync(config['dir_downloads'])) {
    fs.mkdirSync(config['dir_downloads']);
}

//*****************************************************************************
// Override console.log
//*****************************************************************************
const log_name = config['dir_logs'] + '/debug_' + new Date().toISOString().slice(0, 10) + '.log';
let log_file = fs.createWriteStream(log_name, {
    flags: 'a'
});
let log_stdout = process.stdout;

console.log = function(d) {
    const date = new Date().toISOString().slice(0, 19);
    const logStr = '[' + date + '] ' + util.format(d) + '\r\n';
    log_file.write(logStr);
    log_stdout.write(logStr);
};

let num_steps = 4; // Total number of steps for log()

log = function(step, d) {
    let logStr = step + '/' + num_steps + ' ' + util.format(d);
    console.log(logStr);
};

//*****************************************************************************
// Define parameters for Webservices
//*****************************************************************************
process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 1; // only allow authorized SSL/TLS connections
let pf_cert = null;
// try {
//     pf_cert = fs.readFileSync( config[ 'pf_cert_path' ] , "utf8" );
// } catch ( e ) {
//     console.log( e );
// }

//*****************************************************************************
// Setup error handling callback function
//*****************************************************************************
let handle_error = function(err) {
    if (err) {
        console.log(err);
    }
}

// Array of InvoiceReport-objects to keep track of invoices to download
let invoices = [];

let archive_data = true; // true = Already downloaded data, false = Never downloaded data

// Start the download process by downloading a list of all available invoices
getInvoiceListPayer(config['pf_user'], config['pf_pw'], config['pf_eBillAccountID'], archive_data);

//*****************************************************************************
// Call webservice methode getInvoiceListPayer => Response BillerIDs, TransactionIDs, FileTypes
//*****************************************************************************
function getInvoiceListPayer(user, pw, ebill_account_id, archive_data) {
    log(1, 'INFO: getInvoiceListPayer');

    let nonce = crypto.randomBytes(16).toString('base64');
    let timestamp = new Date().toISOString();

    pf_ws.pf_getInvoiceListPayer(user, pw, nonce, timestamp, ebill_account_id, archive_data, config['pf_url'], config['pf_cert_reject_unauthorized'], pf_cert,
        function(ctx) {
            if (ctx.error) {
                console.log('ERROR: SOAP Request failed. ' + ctx.error);
            } else {
                if (config['write_ws_response']) {
                    // Write XML to local file
                    const output_filename = config['dir_lists'] + '/ws_response_InvoiceListPayer_' +
                        new Date().toISOString().slice(0, 19).replace(/:/g, "-") + '.xml';
                    fs.writeFile(output_filename, ctx.response, err => {
                        if (err) {
                            console.error(err);
                            return;
                        }
                    });
                }
                parseInvoiceListPayer(ctx.response); // ===> NEXT STEP
            }
        }
    );
}

function parseInvoiceListPayer(invoiceListPayerResponse) {
    log( 2, 'INFO: parseInvoiceListPayer');
    parseString(invoiceListPayerResponse, function(err, result) {
        const invoiceReports = result['s:Envelope']['s:Body'][0]['GetInvoiceListPayerResponse'][0]['GetInvoiceListPayerResult'][0]['b:InvoiceReport'];
        for (var i = 0 ; i< invoiceReports.length ; i++ ) {
            var invoice = {
                BillerID: invoiceReports[i]['b:BillerID'][0],
                TransactionID: invoiceReports[i]['b:TransactionID'][0],
                DeliveryDate: invoiceReports[i]['b:DeliveryDate'][0],
                FileType: invoiceReports[i]['b:FileType'][0]
            };
            // only add invoice to invoices array if it has a DeliveryDate older than x days
            var days = 1000*60*60*24;
            var today = new Date();
            var deliver_date = new Date(invoice.DeliveryDate);
            var diff_date = Math.round((today - deliver_date)/days);
            if (diff_date >= config['delivery_date_offset']) {
                invoices.push( invoice );
            }
        }
        console.log(invoices);
        processNextInvoice(invoices); // ===> NEXT STEP
    });
}

//*****************************************************************************
// By calling processNextInvoice() repeatedly we process all the available invoices
// serially thus avoiding overwhelming the server.
//*****************************************************************************
function processNextInvoice( invoices ) {
    log( 3, 'INFO: processNextInvoice');
    // If the invoices-array is empty we are done.
    if (invoices.length == 0) {
        return;  // Nothing to do
    }

    var nextInvoice = invoices.shift();

    getInvoicePayer(config['pf_user'], config['pf_pw'], config['pf_eBillAccountID'], nextInvoice.BillerID, nextInvoice.TransactionID, nextInvoice.FileType);
}

//*****************************************************************************
// Call webservice methode getInvoicePayer => File: XML, PDF, (ZIP)
//*****************************************************************************
function getInvoicePayer(user, pw, ebill_account_id, biller_id, transaction_id, file_type) {
    log(4, 'INFO: getInvoicePayer: ' + biller_id + ', ' + transaction_id + ', ' + file_type);

    let nonce = crypto.randomBytes(16).toString('base64');
    let timestamp = new Date().toISOString();

    pf_ws.pf_getInvoicePayer(user, pw, nonce, timestamp, ebill_account_id, biller_id, transaction_id, file_type, config['pf_url'], config['pf_cert_reject_unauthorized'], pf_cert,
        function(ctx) {
            if (ctx.error) {
                console.log('ERROR: SOAP Request failed. ' + ctx.error);
            } else {
                if (config['write_ws_response']) {
                    // Write response XML to local file
                    const output_filename = config['dir_downloads'] + '/ws_response_InvoicePayer_' + biller_id + '_' + transaction_id + '_' + file_type + '.XML';
                    fs.writeFile(output_filename, ctx.response, err => {
                        if (err) {
                            console.error(err);
                            return;
                        }
                    });
                }
                //file written successfully
                parseString(ctx.response, function(err, result) {
                    // Extract content from webservice response
                    try {
                        const data = result['s:Envelope']['s:Body'][0]['GetInvoicePayerResponse'][0]['GetInvoicePayerResult'][0]['b:Data'][0];
                        const filename = result['s:Envelope']['s:Body'][0]['GetInvoicePayerResponse'][0]['GetInvoicePayerResult'][0]['b:Filename'][0];
                        // Write the file to disk
                        fs.writeFile(config['dir_downloads'] + '/' + filename, data, { encoding: 'base64' }, err => {
                            if (err) {
                                console.error(err);
                                return;
                            }
                        });
                    } catch (err) {
                        console.log('ERROR: Parsing response: ' + err);
                        return;
                    }
                    processNextInvoice(invoices); // ===> NEXT STEP
                });
            }
        }
    );
}
