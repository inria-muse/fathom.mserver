/*
   Fathom API server

   Copyright (C) 2015 Inria Paris-Roquencourt 

   The MIT License (MIT)

   Permission is hereby granted, free of charge, to any person obtaining a copy
   of this software and associated documentation files (the "Software"), to deal
   in the Software without restriction, including without limitation the rights
   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
   copies of the Software, and to permit persons to whom the Software is
   furnished to do so, subject to the following conditions:
   
   The above copyright notice and this permission notice shall be included in 
   all copies or substantial portions of the Software.
   
   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
   SOFTWARE.
*/

/* Fetches known IP ranges for several cloud providers and parses the results
 * to a JSON file.
 */
"use strict";

var debug = require('debug')('fathomapiupdater');
var _ = require('underscore');
//var fs = require('fs');
var fs = require('fs-extra');
var path = require('path');
var http = require('http');
var https = require('https');
var exec = require('child_process').exec;
var parseString = require('xml2js').parseString;

var fetchripestats = function(prefix) {   
   return new Promise(function(resolve, reject) {
      const ripeurl = 'https://stat.ripe.net/data/prefix-overview/data.json?resource=';

      https.get(ripeurl + prefix, function(res) {
         if (res.statusCode >= 200 && res.statusCode < 300) {
            let data = '';

            res.on('data', function (chunk) {
               data += chunk;
            });

            res.on('end', function() {
               resolve(JSON.parse(data));
            });

         } else {
            debug('fetchripestats::error ' + res.statusCode + '/' + res.statusMessage);
            reject(res.statusCode);
         }
      }).on('error', function(e) {
         debug('fetchripestats::error ' + e);
         reject(e);
      });
   });
};

var fetchaws = function() {
   return new Promise(function(resolve, reject) {
      const aws = 'https://ip-ranges.amazonaws.com/ip-ranges.json';
      debug('fetchaws get ' + aws);

      https.get(aws, function(res) {
         if (res.statusCode >= 200 && res.statusCode < 300) {
            let data = '';

            res.on('data', function (chunk) {
               data += chunk;
            });

            res.on('end', function() {
               let d = JSON.parse(data);
               let results = [];
               let l = 0;

               debug('fetchaws got ' + d['prefixes'].length + ' prefixes');

               _.each(d['prefixes'], function(p) {
                  l += 1;
                  let obj = {
                        prefix : p['ip_prefix'],
                        region : p['region'],
                        service : p['service'],
                        details : undefined
                  };

                  // avoid conn resets from ripe by spacing out the reqs
                  setTimeout(function() {
                     fetchripestats(obj.prefix).then(function(data) {
                        obj.details = data;
                        results.push(obj);
                        if (l == results.length)
                           resolve(results);

                     }).catch(function(err) {
                        results.push(obj);
                        if (l == results.length)
                           resolve(results);                  
                     });
                  }, l * 100);
               });
            });

         } else {
            debug('fetchaws::error ' + res.statusCode + '/' + res.statusMessage);
            reject(res.statusCode);
         }
      }).on('error', function(e) {
         debug('fetchaws::error ' + e);
         reject(e);
      });
   });
}

var fetchazure = function() {
   return new Promise(function(resolve, reject) {
      // FIXME: this url is not permanent !!!
      const azure = 'https://download.microsoft.com/download/0/1/8/018E208D-54F8-44CD-AA26-CD7BC9524A8C/PublicIPs_20151012.xml';
      debug('fetchazure get ' + azure);

      https.get(azure, function(res) {
         if (res.statusCode >= 200 && res.statusCode < 300) {
            let data = '';

            res.on('data', function (chunk) {
               data += chunk;
            });

            res.on('end', function() {
               parseString(data, function(err, res) {
                  if (err) {
                     debug('fetchazure::error ' + err);
                     reject(err);
                     return;
                  }

                  let results = [];
                  let l = 0;

                  debug('fetchazure got ' + res["AzurePublicIpAddresses"]['Region'].length + ' regions');


                  _.each(res["AzurePublicIpAddresses"]['Region'], function(reg) {
                     debug('fetchazure got ' + reg['IpRange'].length + ' prefixes for ' + reg['$']['Name']);

                     _.each(reg['IpRange'], function(iprange) {
                        l += 1;
                        let obj = {
                              region : reg['$']['Name'],
                              prefix : iprange['$']['Subnet'],
                              details : undefined
                        };

                        // avoid conn resets from ripe by spacing out the reqs
                        setTimeout(function() {
                           fetchripestats(obj.prefix).then(function(data) {
                              obj.details = data;
                              results.push(obj);
                              if (l == results.length)
                                 resolve(results);

                           }).catch(function(err) {
                              results.push(obj);
                              if (l == results.length)
                                 resolve(results);                  
                           });
                        }, l * 100);
                     });                     
                  });
               }); // parseString
            }); // end

         } else {
            debug('fetchazure::error ' + res.statusCode + '/' + res.statusMessage);
            reject(res.statusCode);
         }
      }).on('error', function(e) {
         debug('fetchazure::error ' + e);
         reject(e);
      });
   });
}; // fetchazure

var fetchcloudflare = function() {
   var get = function(url) {
      return new Promise(function(resolve, reject) {
         debug('fetchcloudflare get ' + url);
         https.get(url, function(res) {
            if (res.statusCode >= 200 && res.statusCode < 300) {
               let data = '';

               res.on('data', function (chunk) {
                  data += chunk;
               });

               res.on('end', function() {
                  let results = [];
                  let l = 0;

                  let d = data.split('\n');
                  debug('fetchcloudflare got ' + d.length + " prefixes");

                  _.each(d, function(prefix) {
                     l += 1;
                     let obj = {
                           prefix : prefix.trim(),
                           details : undefined
                     };

                     // avoid conn resets from ripe by spacing out the reqs
                     setTimeout(function() {
                        fetchripestats(obj.prefix).then(function(data) {
                           obj.details = data;
                           results.push(obj);
                           if (l == results.length)
                              resolve(results);

                        }).catch(function(err) {
                           results.push(obj);
                           if (l == results.length)
                              resolve(results);                  
                        });
                     }, l * 100);
                  });
               }); // end

            } else {
               debug('fetchcloudflare::error ' + res.statusCode + '/' + res.statusMessage);
               reject(res.statusCode);
            }
         }).on('error', function(e) {
            debug('fetchcloudflare::error ' + e);
            reject(e);
         });            
      }); // Promise    
   }; // get

   return Promise.all([
      get('https://www.cloudflare.com/ips-v4'),
      get('https://www.cloudflare.com/ips-v6')
   ]).then(_.flatten);

}; // fetchcloudflare

var fetchgae = function() {
   return new Promise(function(resolve, reject) {
      const gae = 'dig +short -t txt _netblocks.google.com';
      debug('fetchgae exec ' + gae);
      exec(gae, function(err, stdout, stderr) {
         if (err!=null) {
            debug('fetchgae::error ' + err);
            debug('fetchgae::stderr ' + stderr);
            reject(err);
            return;
         }

         let results = [];
         let l = 0;

         stdout = stdout.trim().replace('"','');   
         let d = stdout.split(' ');
         debug('fetchgae got ' + d.length-1 + " prefixes");

         _.each(d, function(s){
            if (s.indexOf('ip4:')>=0) {
               l += 1;
               let prefix = s.split(':')[1];

               // avoid conn resets from ripe by spacing out the reqs
               setTimeout(function() {
                  fetchripestats(prefix).then(function(data) {
                     results.push({
                        prefix : prefix,
                        details : data
                     });

                     if (l == results.length)
                        resolve(results);

                  }).catch(function(err) {
                     results.push({
                        prefix : prefix
                     });

                     if (l == results.length)
                        resolve(results);                  
                  });
               }, l * 100);
            }
         });
      }); // exec
   });
}; // fetchgae

var fetchall = function() {
   debug("fetchall");
   Promise.all([
      fetchgae(),
      fetchaws(),
      fetchazure(),
      fetchcloudflare()
   ]).then(function(values) {
      var tmp = {
         created : new Date(),
         providers : {}
      }
      tmp.providers['gae'] = values[0];
      tmp.providers['aws'] = values[1];
      tmp.providers['azure'] = values[2];
      tmp.providers['cloudflare'] = values[3];
   
      var fn = path.resolve(__dirname,'files/clouds_'+tmp.created.toISOString()+'.json');

      debug("fetchall writing " + fn);

      fs.outputJSON(fn, tmp, function(err) {
         if (err) { 
            debug('fetchall failed to write: ' + err);
         } else {
            fs.ensureSymlink(fn, path.resolve(__dirname,'files/clouds.json'));  
         }
      });
   });
};

fetchall();

// testing

//fetchripestats('216.239.32.0/19')
//fetchgae()
//fetchaws()
//fetchcloudflare()
//fetchazure()
//   .then(console.log)
//   .catch(console.log);