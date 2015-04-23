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

/**
 * @fileoverfiew Fetches and parses the IEEE OUI database once a day and 
 *               keeps a copy in a local Redis store for the API cluster.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

var debug = require('debug')('cachemgr')
var _ = require('underscore');
var http = require('http');
var redis = require('redis');

// some configs
const OUIDB = "http://standards.ieee.org/develop/regauth/oui/oui.txt";

// redis client
var db = redis.createClient();
db.on("error", function (err) {
    debug("redis error: " + err);
});

/**
 * Update the manufacturer information from the IEEE site.
 */
var update_cache = function() {
    debug("update_cache");
    var buf = "";

    var v = {};
    var k = undefined;
    var addr = [];

    var write = function() {
	if (k === undefined) return;
	v['ts'] = Date.now();
	v['country'] = addr[addr.length-1];
	_.each(addr.splice(0,(addr.length-1)), function(elem, idx) {
	    v['address'+(idx+1)] = elem;
	});

	db.hmset('mac:'+k, v, function(err, results) {
	    if (err) debug('redis hmset error: ' + err);
	});
    };

    var handleline = function(l) {
	if (l.indexOf('(hex') >= 0) {
	    write();

	    // new element
	    k = l.split(' ')[0].trim().replace(/\-/g,'').toLowerCase();
	    v = {
		company : l.split('\t\t')[1],
	    }
	    addr = [];

	} else if (l.indexOf('(base') < 0 && l.indexOf('Generated:') < 0) {
	    addr.push(l.trim());
	}
    };

    var handlechunk = function(chunk) {
	buf += chunk;
	var idx = buf.indexOf('\n');
	while (idx>=0) {
	    var l = buf.slice(0,idx).trim();
	    if (l.length>0)
		handleline(l);
	    buf = buf.slice((idx+1));
	    idx = buf.indexOf('\n');
	}
    };

    http.get(OUIDB, function(res) {
	debug("update_cache HTTP GET resp: " + res.statusCode);
	if (res.statusCode === 200) {
	    res.setEncoding('utf8');
	    res.on('data', handlechunk);
	    res.on('end', function(chunk) {
		handlechunk(chunk);
		write();
		debug("update_cache done!");
		db.set('mac:lastwritesucc',true);
	    });
	}
    }).on('error', function(e) {
	debug("update_cache error: " + e.message);
	db.set('mac:lastwritesucc',false);
    });
};

// start the first update
update_cache();
