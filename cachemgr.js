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
 * @fileoverfiew Fetches and parses the IEEE OUI database. Stored in a Redis cache.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

var debug = require('debug')('fathom.mserver.cache')

var _ = require('underscore');
var http = require('http');
var redis = require('redis');

// some configs
const OUIDB = "http://standards.ieee.org/develop/regauth/oui/oui.txt";

var UPDATE_FREQ = parseInt(process.env['OUICACHE']) || -1; // only do once

/** Update the manufacturer information from the IEEE. */
var updateOUIcache = function() {
    debug("updateCache");    

	// redis client
	var db = redis.createClient();
	if (!db) {
		debug("redis create failed");
		process.exit(1);
	}

	db.on("error", function (err) {
		debug("redis connect or fatal error: " + err);
 		process.exit(2);
	});

	db.set('mac:lastwritets', Date.now());

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

    var done = function(succ) {
		debug("updateCache done!");
		db.set('mac:lastwritesucc',succ);
		db.quit();

	    // schedule next update ?
	    if (UPDATE_FREQ > 0) {
	    	setTimeout(updateOUIcache, UPDATE_FREQ*1000);
	    } else {
	    	process.exit(0);
	    }
    }

    http.get(OUIDB, function(res) {
		debug("updateCache HTTP GET resp: " + res.statusCode);
		if (res.statusCode === 200) {
		    res.setEncoding('utf8');
		    res.on('data', handlechunk);
		    res.on('end', function(chunk) {
				handlechunk(chunk);
				write();
				done(true);
		    });
		} else if (res.statusCode === 302) {
			done(true); // no changes
		} else {
			done(false);
		}
    }).on('error', function(e) {
		debug("updateCache error: " + e.message);
		done(false);
    });
};

// first run
updateOUIcache();
