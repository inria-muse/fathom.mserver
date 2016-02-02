/*
   Fathom API server

   Copyright (C) 2015-2016 Inria Paris-Roquencourt 

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
 * @fileoverfiew Tools.
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */
var exec = require('child_process').exec;

var debug = require('debug')('fathomapi:tools');

var _ = require('underscore');
var ipaddr = require('ipaddr.js');
var whois = require('whois');

// build sanitized sys exec command string from key-value dict
var buildcmd = function(cmd, args, tail) {
  cmd += ' ';
  cmd += _.map(args, function(v,k) {
    var tmp = '-'+k;
    if (v != null) {
       tmp += ' '+v;
    }
    return "'" + tmp.replace(/'/g,"\'") + "'";
  }).join(' ');

  if (tail)
    cmd += ' ' + tail;

  return cmd.replace(/\s+/g, ' ');
};

/** Reverse DNS lookup of ip (using 'dig -x'). */
var _revdns = exports.reverseDns = function(cb, ip) {
   var cmd = 'dig +short -x ' + ip; 
   debug('reverseDns::cmd: ' + cmd);

   exec(cmd, function(err, stdout, stderr) {
      if (err!=null) {
         debug('reverseDns::error: ' + err);
         debug('reverseDns::stderr: ' + stderr);
         cb({ error : 'dns lookup failed: [' + err.code + ']' + stderr }, undefined);
      } else {
         cb(undefined, stdout.trim());
      }
   });
};

/** Whois lookup of given IP. */
var _whois = exports.whois = function(cb, ip) {
   var parsewhois = function(data) {
      var res = { netblock : undefined, asblock : undefined };
      var blocks = data.split('\n\n');
      _.each(blocks,function(b) {
         var tmpblock = {};
         var lines = b.split('\n');
         _.each(lines, function(line) {
            if (line.length <= 1 || line.indexOf('%')==0 || line.indexOf(': ')<0) {
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

   if (!ip || ip.length<=0 || ip === "127.0.0.1") {
      cb({ error : 'invalid ip: ' + ip }, undefined);
   } else {
      whois.lookup(ip, function(err, data) {
         if (!err && data)
            cb(undefined, parsewhois(data));
         else
            cb({ error : err }, undefined);
      });
   }
};

/** IP geolocation using local MaxMind DB. */
var _geo = exports.geo = function(cb, ip) {
   var handler = function(err, stdout, stderr) {
      if (err!=null) {
         debug('geo::error: ' + err);
         debug('geo::stderr: ' + stderr);
         cb({ error : 'geoiplookup failed: [' + err.code + ']' + stderr }, undefined);
         return;
      }

      var obj = {};
      obj['ip'] = ip;

      _.each(stdout.split('\n'), function(l) {
         var tmp = l.split(':');
         if (tmp.length < 2)
            return;

         if (tmp[0].indexOf('Country Edition')>=0 && tmp[1].indexOf('IP Address not found') < 0) {
            tmp = tmp[1].trim().split(',')
            obj.cc = tmp[0].trim();
            obj.country = tmp[1].trim();
          } else if (tmp[0].indexOf('ISP Edition')>=0 && tmp[1].indexOf('IP Address not found') < 0) {
            obj.isp = tmp[1].trim();
          } else if (tmp[0].indexOf('Organization Edition')>=0 && tmp[1].indexOf('IP Address not found') < 0) {
            obj.org = tmp[1].trim();
          } else if (tmp[0].indexOf('City Edition, Rev 1')>=0 && tmp[1].indexOf('IP Address not found') < 0) {
            tmp = tmp[1].trim().split(',')
            obj.city = tmp[2].trim();
            obj.lat = parseFloat(tmp[4].trim());
            obj.lon = parseFloat(tmp[5].trim());
          }
      }); // each

      cb(undefined, obj);

   }; // geolookup handler
 
   if (!ip || ip.length<=0 || ip === "127.0.0.1") {
      cb({ error : 'invalid ip: ' + ip }, undefined);
   } else if (ipaddr.IPv4.isValid(ip)) {
      exec('geoiplookup ' + ip, handler);  
   } else if (ipaddr.IPv6.isValid(ip)) {
      exec('geoiplookup6 ' + ip, handler);
   } else {
      cb({ error : 'invalid ip: ' + ip }, undefined);
   }
}; // geo

/** Ping given IP. */
var _ping = exports.ping = function(cb, ip, args) {
   // default param for number of pings
   if (!args['c'])
     args['c'] = 5;

   var cmd = buildcmd('ping',args,ip); 
   debug(cmd);

   var result = {
      cmd : 'ping',
      cmdline : cmd,
      dst : ip,
      dst_ip : ip,
      count : args['c'],
      bytes : args['b'] || 56,
      lost : 0,
      rtt : []
   };

   exec(cmd, function(err, stdout, stderr) {
      if (err || !stdout || stdout.length < 1) {
         debug('ping failed',err);
         // failed
         result.error = { 
            type : 'execerror',
            message : stderr || stdout,
            error : err
         };
         cb(result, undefined);
         return;
      }

      var lines = (stdout ? stdout.trim() : "").split("\n");
      var i, line;
      for (i = 0; i < lines.length; i++) {      
         line = lines[i].trim().replace(/\s+/g, ' ').split(' ');
         if (lines[i].toLowerCase().indexOf('time to live exceeded')>=0) {
             break;             
         } else if (line[0] === 'PING') {
             result.dst_ip = line[2].replace(/\(|\)|:/gi, '');
             result.bytes = parseInt((line[3].indexOf('\(') < 0 ? line[3] : line[3].substring(0,line[3].indexOf('\('))));

         } else if (line[1] === 'bytes') {
            for (var j = 2; j < line.length; j++) {
               if (line[j].indexOf('time=') === 0) {
                  var tmp = line[j].split('=');
                  result.rtt.push(parseFloat(tmp[1]));
               }
            }
         }
      }
      result.lost = result.count - result.rtt.length;
      cb(undefined, result);
   }); // exec
}; // ping

/** Traceroute to given IP. */
var _mtr = exports.mtr = function(cb, ip, args) {
   if (!args['c'])
     args['c'] = 3;
    args['n'] = null;

   var cmd = buildcmd('mtr',args,'--raw '+ip); 
   debug(cmd);

   var result = {
      cmd : 'mtr',
      dst : ip,
      cmdline : cmd,
      nqueries : (args.c ? parseInt(args.c) : 10),
      hops: [],
      success : false
   };

   exec(cmd, function(err, stdout, stderr) {
      if (err || !stdout || stdout.length < 1) {
         debug('mtr failed',err);
         // failed
         result.error = { 
            type : 'execerror',
            message : stderr || stdout,
            error : err
         };
         cb(result, undefined);
         return;
      }

      var lines = (stdout ? stdout.trim() : "").split("\n");
      for (var i = 0; i < lines.length; i++) {
         var tmp = lines[i].trim().split(' ');
         var hopid = parseInt(tmp[1]);
         switch (tmp[0]) {
         case 'h':
            result.hops[hopid] = { 
               address : tmp[2],
               hostname : undefined, 
               missed : result.nqueries, 
               rtt : [] 
            };
            break;

         case 'p':
            var hop = result.hops[hopid];
            hop.missed -= 1;
            hop.rtt.push(parseInt(tmp[2])/1000.0);
            break;

         case 'd':
            var hop = result.hops[hopid];
            hop.hostname = tmp[2];
            break;
         }
      }

      // did we reach the destination ?
      result.success = (result.hops.length > 0 && 
                        (result.hops[result.hops.length-1].address === result.dst ||
                         result.hops[result.hops.length-1].hostname === result.dst));

      // trim off the last dupl hop (happens if we reach the destination)
      if (result.hops.length > 1 && 
           (result.hops[result.hops.length-1].address === 
            result.hops[result.hops.length-2].address)) {
         result.hops = result.hops.slice(0,result.hops.length-1);
      }
      cb(undefined, result);
   }); // exec
}; //mtr