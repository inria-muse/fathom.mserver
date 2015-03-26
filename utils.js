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
 * @fileoverfiew Helper functions.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

var debug = require('debug')('mserver:utils')
var _ = require('underscore');

/** Parse whois data to JSON. */
var parsewhois = exports.parsewhois = function(data) {
    var res = { netblock : undefined, asblock : undefined };
    var blocks = data.split('\n\n');
    _.each(blocks,function(b) {
	var tmpblock = {};
	var lines = b.split('\n');
	_.each(lines, function(line) {
	    if (line.length <= 1 || line.indexOf('%')==0 || 
		line.indexOf(': ')<0) {
		return;
	    }
	    var tmp = line.split(': ');
	    var k = tmp[0].trim();
	    var v = tmp[1].trim();
	    if (tmpblock[k])
		tmpblock[k] += ';' + v;
	    else
		tmpblock[k] = v;
	});
	if (tmpblock.origin)
	    res.asblock = tmpblock;
	else if (tmpblock.inetnum)
	    res.netblock = tmpblock;
    });
    return res;
};

// IP helper
var getip = exports.getip = function(req) {
    var ip = req.headers['x-forwarded-for'] || 
	req.connection.remoteAddress || 
	req.socket.remoteAddress ||
	req.connection.socket.remoteAddress ||
	req.ip;
    ip = ip.replace('::ffff:','');
    return ip;
};

/* Timestamp helper */
exports.TS = function TS() {
    // current time is calculated as baseTime + (process.hrtime() - baseTimeHr)
    var baseTime = new Date().getTime(); // milliseconds
    var baseTimeHr = process.hrtime();   // [seconds, nanosec]

    /* Source: https://github.com/firefoxes/diff-hrtime
     * @return node.js hrtime diff
     */
    var diffHrtime = function(b, a){
        // desctructure/capture secs and nanosecs
        var as = a[0], ans = a[1],
        bs = b[0], bns = b[1],
        ns = ans - bns, // nanosecs delta, can overflow (will be negative)
        s = as - bs // secs delta
        if (ns < 0) { // has overflowed
            s -= 1 // cut a second
            ns += 1e9 // add a billion nanosec (to neg number)
        }
        return s + ns/1e9; 
    };

    // get base reference time
    this.getbasets = function() {
        return baseTime + 0.0;
    };
    
    // get current time
    this.getts = function() {
        var hrt = process.hrtime();
        var diff = diffHrtime(baseTimeHr, hrt);
        return baseTime + diff; 
    };

    // diff between now and ts
    this.diff = function(ts) {
        return Math.abs(ts - this.getts());
    };
};
