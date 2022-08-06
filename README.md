DOCUMENTATION
=============
Information about the Postfinance webservice:
[https://www.postfinance.ch/content/dam/pfch/doc/460_479/460_109_en.pdf](https://www.postfinance.ch/content/dam/pfch/doc/460_479/460_109_en.pdf)

**WSDL**: [https://ebill-ki.postfinance.ch/B2BService/B2BService.svc?singleWsdl](https://ebill-ki.postfinance.ch/B2BService/B2BService.svc?singleWsdl)

**Now using async/await and promises instead of callbacks.**

Requirements/Setup
-------------------
- Node.js and NPM have to be installed
- Copy the contents of this repository into your working directory
- Install the node-modules with:
  $ npm install
- Enter valid Postfinance credentials in 'pf_config_TEST.json':
  - Username (pf_user)
  - Password (pf_pw)
  - eBill-AccountID (pf_eBillAccountID)
- Run the app:
  $ node pf_get_invoices.js

Program sequence overview
--------------------------
- Download the list of new invoices from the Postfinance webservice
- Download the RGXMLSIG file for every TransactionID, BillerID (RGXMLSIG contains all the relevant files XML, PDF, SIG)
- Extract 'PDFInvoice', 'RGXml' (and appendix if present) and save them as separate files


Function invocation
--------------------
1. downloadInvoices(): MAIN function which controls the application flow
2. pf_getInvoiceListPayer()
3. parseInvoiceListPayer() => 'invoices' array
4. pf_getInvoicePayer(): While Array 'invoices' has entries
5. parseInvoicePayerResponse(): While Array 'invoices' has entries
6. createZipArchive(): While Array 'invoices' has entries if CONFIG.create_zip_file is true