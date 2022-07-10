DOCUMENTATION
=============
Information about the Postfinance webservice:
[https:www.postfinance.ch/content/dam/pfch/doc/460_479/460_109_en.pdf](https:www.postfinance.ch/content/dam/pfch/doc/460_479/460_109_en.pdf)

**WSDL**: [https:ebill-ki.postfinance.ch/B2BService/B2BService.svc?singleWsdl](https:ebill-ki.postfinance.ch/B2BService/B2BService.svc?singleWsdl)

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
- Download the XML and PDF file for every TransactionID, BillerID, FileType

Function invocation
--------------------
1. getInvoiceListPayer(): 1x
2. pf_getInvoiceListPayer(): 1x
3. parseInvoiceListPayer(): 1x
4. processNextInvoice(): While Array 'invoices' has entries
5. getInvoicePayer(): While Array 'invoices' has entries
6. pf_getInvoicePayer(): While Array 'invoices' has entries
