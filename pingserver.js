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
 * @fileoverfiew UDP echo server for RTT measurements.
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */
var debug = require('debug')('fathomapiping');
var dgram = require('dgram');
var TS = require('./utils').TS;

const port = parseInt(process.env.PORT) || 5790;

function server(port) {
    var srv = dgram.createSocket('udp4');
    var tr = new TS();

    srv.on('message', function(buf,rinfo) {
      	var ts = tr.getts();
      	debug("req from " + rinfo.address + ":" + rinfo.port);

        var data = buf.toString('utf8');
        try {
            var obj = JSON.parse(data);	
            if (obj!==undefined && obj.seq!==undefined) {
                obj.r = ts;
                obj.ra = rinfo.address;
                obj.rp = rinfo.port;

                var respstr = JSON.stringify(obj);
                var bufout = new Buffer(respstr,'utf8');
                srv.send(bufout,0,bufout.length,rinfo.port,rinfo.address);
            }
        } catch (e) {
            debug('malformed ping request: '+e);
            debug(data);
        }
    });

    srv.on('error', function(e) {		    
    	debug('udp error: '+e);
    });

    srv.bind(port);
    debug("udp pingserver listening on *:"+port+"...");
};

server(port);