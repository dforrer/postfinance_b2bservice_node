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
// - Extract 'PDFInvoice', 'RGXml' (and appendix if present) and save them as separate files
//
// Function invocation
// --------------------
// 1. downloadInvoices(): MAIN function which controls the application flow
// 2. pf_getInvoiceListPayer()
// 3. parseInvoiceListPayer() => 'invoices' array
// 4. pf_getInvoicePayer(): While Array 'invoices' has entries
// 5. parseInvoicePayerResponse(): While Array 'invoices' has entries
// 6. createZipArchive(): While Array 'invoices' has entries if CONFIG.create_zip_file is true
//*****************************************************************************

//*****************************************************************************
// Load node.js modules
//*****************************************************************************
const fs = require('fs');
const util = require('util');
const xml2js = require('xml2js');
const parseString = xml2js.parseString;
const AdmZip = require("adm-zip");

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

// true = get already downloaded data, false = get never downloaded data
const archive_data = CONFIG.pf_archive_data;
// Start the download process
downloadInvoices(archive_data);

/**
 * MAIN function that controls the flow of the application
 * @param archive_data  boolean (true, false)
 */
async function downloadInvoices(archive_data) {
    console.log('INFO: downloadInvoices');
    let invoices; // Array of InvoiceReport-objects to keep track of invoices to download
    try {
        // waiting for async functions
        let res = await pf_ws.pf_getInvoiceListPayer(CONFIG.pf_user, CONFIG.pf_pw, CONFIG.pf_eBillAccountID, archive_data, CONFIG.pf_url, CONFIG.pf_cert_reject_unauthorized, pf_cert);
        invoices = await parseInvoiceListPayer(res.response);
        if (CONFIG.write_ws_response) {
            const output_filename = CONFIG.dir_lists + '/ws_response_InvoiceListPayer_' +
                new Date().toISOString().slice(0, 19).replace(/:/g, "-") + '.xml';
            await writeFile(output_filename, res.response); // Write XML to local file
        }
    } catch (e) {
        console.error(e);
        return;
    }

    if ( !CONFIG.download_invoices ) {
        console.log('INFO: invoice download disabled')
        return;
    }
    while (invoices.length > 0) {
        let invoice = invoices.shift();
        // avoids a problem where two invoices from the same supplier have the same reference
        invoice.FileName = invoice.FileName + '_' + invoices.length;
        fs.mkdirSync(CONFIG.dir_downloads + '/' + invoice.FileName);
        try {
            // waiting for async functions
            let res = await pf_ws.pf_getInvoicePayer(CONFIG.pf_user, CONFIG.pf_pw, CONFIG.pf_eBillAccountID, invoice.BillerID, invoice.TransactionID, invoice.FileType, CONFIG.pf_url, CONFIG.pf_cert_reject_unauthorized, pf_cert);
            invoice = await parseInvoicePayerResponse(invoice, res.response);
            if (CONFIG.write_ws_response) {
                const output_filename = CONFIG.dir_downloads + '/ws_response_InvoicePayer_' + invoice.BillerID + '_' + invoice.TransactionID + '_' + invoice.FileType + '.XML';
                await writeFile(output_filename, res.response); // Write response XML to local file
            }
            if (CONFIG.create_zip_file) {
                await createZipArchive(invoice);
                fs.rmSync(CONFIG.dir_downloads + '/' + invoice.FileName, { recursive: true, force: true });
            }
        } catch (e) {
            console.error(e);
            return;
        }
    }
}

/**
 * Parses the response of pf_getInvoiceListPayer and returns an array of invoices
 * @param   response    String
 * @return  invoices    Array
 */
async function parseInvoiceListPayer(response) {
    console.log('INFO: parseInvoiceListPayer');
    let parsed_res = await parseXML(response);
    let invoices = [];
    const datetime = new Date().toISOString().replace(/[^a-z0-9]/gi,'').substring(0,15);
    const invoiceReports = parsed_res['s:Envelope']['s:Body'][0]['GetInvoiceListPayerResponse'][0]['GetInvoiceListPayerResult'][0]['b:InvoiceReport'];
    for (let i = 0 ; i< invoiceReports.length ; i++ ) {
        let invoice = {
            BillerID: invoiceReports[i]['b:BillerID'][0],
            TransactionID: invoiceReports[i]['b:TransactionID'][0],
            DeliveryDate: invoiceReports[i]['b:DeliveryDate'][0],
            FileType: invoiceReports[i]['b:FileType'][0]
        };
        invoice.FileName = invoice.BillerID + '_' + invoice.TransactionID + '_' + datetime;
        // RGXMLSIG is the only FileType we need to download because it contains all the relevant data
        if (invoice.FileType === 'RGXMLSIG') {
            // only add invoice to invoices array if it has a DeliveryDate older than x hours
            let hours = 1000*60*60;
            let today = new Date();
            let delivery_date = new Date(invoice.DeliveryDate);
            let diff_hours = Math.round((today - delivery_date)/hours);
            if (diff_hours >= CONFIG.delivery_date_delay_in_hours) {
                invoices.push( invoice );
            }
        }
    }
    console.log(invoices);
    return invoices;
}

/**
 * Parses the response of pf_getInvoicePayer.
 * Changes the 'invoice'-object and returns it.
 * @param   invoice     JS-object
 * @param   response    String
 * @return  invoice     JS-object
 */
async function parseInvoicePayerResponse(invoice, response) {
    console.log('INFO: parseInvoicePayerResponse');
    const parsed_res = await parseXML(response);
    // Extract content from webservice response (requires RGXMLSIG)
    invoice.invoicePayerResultBase64 = parsed_res['s:Envelope']['s:Body'][0]['GetInvoicePayerResponse'][0]['GetInvoicePayerResult'][0]['b:Data'][0];
    await writeFile(CONFIG.dir_downloads + '/' + invoice.FileName + '/RGXMLSIG_' + invoice.FileName + '.xml', invoice.invoicePayerResultBase64, { encoding: 'base64' } );
    // Convert invoice.invoicePayerResultBase64 to utf8
    invoice.invoicePayerResultUTF8 = Buffer.from(invoice.invoicePayerResultBase64, 'base64').toString('utf8');
    const parsedUTF8 = await parseXML(invoice.invoicePayerResultUTF8);
    const res_objects = parsedUTF8['Signature']['Object'];
    for (let i = 0; i < res_objects.length ; i++) {
        switch ( res_objects[i]['$']['Id'] ) {
        case 'PDFInvoice':
            await writeFile(CONFIG.dir_downloads + '/' + invoice.FileName + '/' + invoice.FileName + '.pdf', res_objects[i]['_'], { encoding: 'base64' } );
            break;
        case 'RGXml':
            const builder = new xml2js.Builder({
               headless: true,
               allowSurrogateChars: true,
               rootName: 'Envelope',
               cdata: false
            });
            let xml = builder.buildObject(res_objects[i]['Envelope'][0]).toString();
            if (CONFIG.convert_biller_id == true) {
                if (biller_id_list[invoice.BillerID] !== undefined) {
                    xml = xml.replace('<BillerID>' + invoice.BillerID + '</BillerID>', '<BillerID>' + biller_id_list[invoice.BillerID] + '</BillerID>');
                }
            }
            await writeFile(CONFIG.dir_downloads + '/' + invoice.FileName + '/' + invoice.FileName + '.xml', xml );
            // save Appendix
            if (res_objects[i]['Envelope'][0]['Body'][0]['Appendix']) {
                const app = res_objects[i]['Envelope'][0]['Body'][0]['Appendix'][0]['Document'][0]['_'];
                //console.log(app);
                const appendix_filename = res_objects[i]['Envelope'][0]['Body'][0]['Appendix'][0]['Document'][0]['$']['FileName'];
                await writeFile(CONFIG.dir_downloads + '/' + invoice.FileName + '/Appendix_' + appendix_filename, app, { encoding: 'base64' } );
            }
            break;
        default:
            //console.log('type:' + res_objects[i]['$']['Id']);
        }
    }
    return invoice;
}

/**
 * Creates a zip-file for every invoice-directory
 * @param   invoice     JS-object
 */
async function createZipArchive(invoice) {
  try {
    const zip = new AdmZip();
    const outputFile = CONFIG.dir_downloads + '/' + invoice.FileName + ".zip";
    zip.addLocalFolder(CONFIG.dir_downloads + '/' + invoice.FileName);
    zip.writeZip(outputFile);
    console.log(`INFO: Zip ${outputFile} created.`);
  } catch (e) {
    console.log(`ERROR: Zip ${e}`);
  }
}

/**
 * Promisify parseString from xml2js
 * @param   xml         String
 * @return  promise     JS-promise
 */
async function parseXML(xml) {
    const promise = await new Promise((resolve, reject) => {
        parseString(xml, (error, result) => {
            if (error) {
                reject(error);
            } else {
                resolve(result);
            }
        });
    });
    return promise;
}

/**
 * Promisify fs.writeFile
 * @param   filename    String
 * @param   content     data to write
 * @param   options     JS-object, e.g. { encoding: 'base64' }
 * @return  promise     JS-promise
 */
async function writeFile(filename, content, options) {
    const promise = await new Promise((resolve, reject) => {
        fs.writeFile(filename, content, options, err => {
            if (err) {
                reject(error);
            } else {
                resolve(filename);
            }
        });
    });
    return promise;
}
