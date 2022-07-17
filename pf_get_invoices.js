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
// - Download the RGXMLSIG file for every TransactionID, BillerID
//   (RGXMLSIG contains all the relevant files XML, PDF, SIG)
//
// Function invocation
// --------------------
// 1. getInvoiceListPayer(): 1x
// 1.1. pf_getInvoiceListPayer(): 1x
// 2. parseInvoiceListPayer(): 1x
// 3. processNextInvoice(): While Array 'invoices' has entries
// 4. getInvoicePayer(): While Array 'invoices' has entries
// 4.1. pf_getInvoicePayer(): While Array 'invoices' has entries
// 5. parseInvoicePayerResponse(): While Array 'invoices' has entries
// 6. parsePayerResult(): While Array 'invoices' has entries
//*****************************************************************************

//*****************************************************************************
// Load node.js modules
//*****************************************************************************
const fs = require('fs');
const util = require('util');
const crypto = require('crypto');
const xml2js = require('xml2js');
const parseString = xml2js.parseString;

//*****************************************************************************
// Load custom modules
//*****************************************************************************
const pf_ws = require('./pf_webservices.js')

//*****************************************************************************
// Open application specific configuration and mappings
//*****************************************************************************
global.CONFIG = require('./pf_config_TEST.json')

//*****************************************************************************
// Create directories if they don't exist already
//*****************************************************************************
if (!fs.existsSync(CONFIG.dir_logs)) {
    fs.mkdirSync(CONFIG.dir_logs);
}
if (!fs.existsSync(CONFIG.dir_lists)) {
    fs.mkdirSync(CONFIG.dir_lists);
}
if (!fs.existsSync(CONFIG.dir_downloads)) {
    fs.mkdirSync(CONFIG.dir_downloads);
}

//*****************************************************************************
// Override console.log
//*****************************************************************************
const log_name = CONFIG.dir_logs + '/debug_' + new Date().toISOString().slice(0, 10) + '.log';
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

let num_steps = 6; // Total number of steps for log()

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
//     pf_cert = fs.readFileSync( CONFIG.pf_cert_path , "utf8" );
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

// Load biller_id list mappings
let biller_id_list = {};
if (CONFIG.convert_biller_id == true) {
    // Load semicolon separated CSV-file 'biller_id_list.csv'
    let csv = fs.readFileSync(CONFIG.biller_id_mapping_path, 'utf8');
    csv = csv.split('\r\n');
    for (let i = 0; i < csv.length; i++) {
        csv[i] = csv[i].split(';');
        biller_id_list[csv[i][0]] = csv[i][1];
    }
}

// Array of InvoiceReport-objects to keep track of invoices to download
let invoices = [];

let archive_data = CONFIG.pf_archive_data; // true = Already downloaded data, false = Never downloaded data

// Start the download process by downloading a list of all available invoices
getInvoiceListPayer(archive_data);

//*****************************************************************************
// Call webservice methode getInvoiceListPayer => Response BillerIDs, TransactionIDs, FileTypes
//*****************************************************************************
function getInvoiceListPayer(archive_data) {
    log(1, 'INFO: getInvoiceListPayer');

    let nonce = crypto.randomBytes(16).toString('base64');
    let timestamp = new Date().toISOString();

    pf_ws.pf_getInvoiceListPayer(CONFIG.pf_user, CONFIG.pf_pw, nonce, timestamp, CONFIG.pf_eBillAccountID, archive_data, CONFIG.pf_url, CONFIG.pf_cert_reject_unauthorized, pf_cert,
        function(ctx) {
            if (ctx.error) {
                console.log('ERROR: SOAP Request failed. ' + ctx.error);
            } else {
                if (CONFIG.write_ws_response) {
                    // Write XML to local file
                    const output_filename = CONFIG.dir_lists + '/ws_response_InvoiceListPayer_' +
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
            invoice.FileName = invoice.BillerID + '_' + invoice.TransactionID;
            // RGXMLSIG is the only FileType we need to download because it contains all the relevant data
            if (invoice.FileType === 'RGXMLSIG') {
                // only add invoice to invoices array if it has a DeliveryDate older than x hours
                var hours = 1000*60*60;
                var today = new Date();
                var delivery_date = new Date(invoice.DeliveryDate);
                var diff_hours = Math.round((today - delivery_date)/hours);
                if (diff_hours >= CONFIG.delivery_date_delay_in_hours) {
                    invoices.push( invoice );
                }
            }
        }
        console.log(invoices);
        processNextInvoice(); // ===> NEXT STEP
    });
}

//*****************************************************************************
// By calling processNextInvoice() repeatedly we process all the available invoices
// serially thus avoiding overwhelming the server.
//*****************************************************************************
function processNextInvoice() {
    log( 3, 'INFO: processNextInvoice');
    // If the invoices-array is empty we are done.
    if (invoices.length == 0) {
        return;  // Nothing to do
    }

    let invoice = invoices.shift();
    let invoice_dir = CONFIG.dir_downloads + '/' + invoice.FileName;
    if ( !fs.existsSync(invoice_dir) ) {
        fs.mkdirSync(invoice_dir);
    }
    getInvoicePayer(invoice);
}

//*****************************************************************************
// Call webservice methode getInvoicePayer => File: XML, PDF, (ZIP)
//*****************************************************************************
function getInvoicePayer(invoice) {
    log(4, 'INFO: getInvoicePayer: ' + invoice.BillerID + ', ' + invoice.TransactionID + ', ' + invoice.FileType);

    let nonce = crypto.randomBytes(16).toString('base64');
    let timestamp = new Date().toISOString();

    pf_ws.pf_getInvoicePayer(CONFIG.pf_user, CONFIG.pf_pw, nonce, timestamp, CONFIG.pf_eBillAccountID, invoice.BillerID, invoice.TransactionID, invoice.FileType, CONFIG.pf_url, CONFIG.pf_cert_reject_unauthorized, pf_cert,
        function(ctx) {
            if (ctx.error) {
                console.log('ERROR: SOAP Request failed. ' + ctx.error);
            } else {
                if (CONFIG.write_ws_response) {
                    // Write response XML to local file
                    const output_filename = CONFIG.dir_downloads + '/ws_response_InvoicePayer_' + biller_id + '_' + transaction_id + '_' + file_type + '.XML';
                    fs.writeFile(output_filename, ctx.response, err => {
                        if (err) {
                            console.error(err);
                            return;
                        }
                    });
                }
                invoice.invoicePayerResponse = ctx.response;
                parseInvoicePayerResponse(invoice); // ===> NEXT STEP
            }
        }
    );
}

function parseInvoicePayerResponse(invoice) {
    log( 5, 'INFO: parseInvoicePayerResponse');
    parseString(invoice.invoicePayerResponse, function(err, result) {
        if (err) {
            console.error(err);
            return;
        }
        // Extract content from webservice response (requires RGXMLSIG)
        invoice.invoicePayerResultBase64 = result['s:Envelope']['s:Body'][0]['GetInvoicePayerResponse'][0]['GetInvoicePayerResult'][0]['b:Data'][0];
        //const filename = result['s:Envelope']['s:Body'][0]['GetInvoicePayerResponse'][0]['GetInvoicePayerResult'][0]['b:Filename'][0];
        fs.writeFile(CONFIG.dir_downloads + '/' + invoice.FileName + '/RGXMLSIG_' + invoice.FileName + '.xml', invoice.invoicePayerResultBase64, { encoding: 'base64' }, err => {
            if (err) {
                console.error(err);
                return;
            }
        });
        // Convert invoice.invoicePayerResultBase64 to utf8
        invoice.invoicePayerResultUTF8 = Buffer.from( invoice.invoicePayerResultBase64, 'base64').toString('utf8');
        parsePayerResult(invoice); //===> NEXT STEP
    });
}

function parsePayerResult(invoice) {
    log( 6, 'INFO: parsePayerResult');
    parseString(invoice.invoicePayerResultUTF8, function (err, result) {
        if (err) {
            console.error(err);
            return;
        }
        let res_objects = result['Signature']['Object'];
        for (let i = 0; i < res_objects.length ; i++) {
            if (res_objects[i]['$']['Id'] == 'RGXml') {
                //console.log(JSON.stringify(res_objects[i]));
                const builder = new xml2js.Builder({
                   headless: true,
                   allowSurrogateChars: true,
                   rootName: 'Envelope',
                   cdata: false
                });
                var xml = builder.buildObject(res_objects[i]['Envelope'][0]).toString();
                if (CONFIG.convert_biller_id == true) {
                    if (biller_id_list[invoice.BillerID] !== undefined) {
                        xml = xml.replace('<BillerID>' + invoice.BillerID + '</BillerID>', '<BillerID>' + biller_id_list[invoice.BillerID] + '</BillerID>');
                    }
                }
                fs.writeFile(CONFIG.dir_downloads + '/' + invoice.FileName + '/' + invoice.FileName + '.xml', xml, err => {
                    if (err) {
                        console.error(err);
                        return;
                    }
                });
                // save Appendix
                if (res_objects[i]['Envelope'][0]['Body'][0]['Appendix']) {
                    let app = res_objects[i]['Envelope'][0]['Body'][0]['Appendix'][0]['Document'][0]['_'];
                    //console.log(app);
                    let appendix_filename = res_objects[i]['Envelope'][0]['Body'][0]['Appendix'][0]['Document'][0]['$']['FileName'];
                    fs.writeFile(CONFIG.dir_downloads + '/' + invoice.FileName + '/Appendix_' + appendix_filename, app, { encoding: 'base64' }, err => {
                        if (err) {
                            console.error(err);
                            return;
                        }
                    });
                }
            }
            if (res_objects[i]['$']['Id'] == 'PDFInvoice') {
                fs.writeFile(CONFIG.dir_downloads + '/' + invoice.FileName + '/' + invoice.FileName + '.pdf', res_objects[i]['_'], { encoding: 'base64' }, err => {
                    if (err) {
                        console.error(err);
                        return;
                    }
                });
            }
        }
    });
    processNextInvoice(); // ===> NEXT STEP
}
