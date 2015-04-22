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
 * @fileoverfiew REST API using express. Provides MAC and IP lookups and
 * reverse pings and traceroutes.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

var os = require('os');
var exec = require('child_process').exec;

// external dependencies
var debug = require('debug')('mserver')
var _ = require('underscore');
var redis = require('redis');
var express = require('express');
var bodyParser = require('body-parser');
var ipaddr = require('ipaddr.js');
var whois = require('node-whois');
var moment = require("moment");

// helpers
var utils = require('./utils');

// configs
var port = parseInt(process.env.PORT) || 3000;
var MAX_MTR = parseInt(process.env['MAX_MTR']) || 10;
var MAX_PING = parseInt(process.env['MAX_PING']) || 10;

// mtr processes
var curr_mtr = 0;
// ping processes
var curr_ping = 0;

// redis client
var db = redis.createClient();
db.on("error", function (err) {
    debug("redis error: " + err);
});

// runtime stats
var rstats = 'fathom_mserver';
db.hmset(rstats, {
    start : new Date(),
    geolookup : 0,
    maclookup : 0,
    revping : 0,
    revmtr : 0,
    error : 0, 
    limerror : 0,
    wsping : 0,
    last_geolookup : null,
    last_maclookup : null,
    last_revping : null,
    last_revmtr : null,
    last_error : null,
    last_limerror : null,
    last_wsping : null,
    last_geolookup_ip : null,
    last_maclookup_ip : null,
    last_revping_ip : null,
    last_revmtr_ip : null,
    last_error_ip : null,
    last_limerror_ip : null,
    last_wsping_ip : null
});

var incstat = function(what, ip) {
    try {
        if (db) {
	    var obj = {};
	    obj["last_"+what] = new Date();
	    obj["last_"+what+"_ip"] = ip;
            db.hmset(rstats, obj);
            db.hincrby(rstats, what, 1);
        }
    } catch(e) {
    }
}

// main app
var app = express();

// websocket end-point
var expressWs = require('express-ws')(app); 

// we'll be behind a proxy
app.enable('trust proxy');

// middleware
app.use(bodyParser.json());

// err handler
app.use(function(err, req, res, next) {
    debug(err);
    debug(err.stack);
    res.type('application/json');
    res.status(500).send({ error: "internal server error",
			   details: err});
    incstat('error', utils.getip(req));
});

//----  routes  -----

// GET returns some basic stats about the server
app.all('/', function(req, res) {
    if (db)
	db.hgetall(rstats, function(err, obj) {
            res.type('text/plain');
            obj.uptime = "Started " + moment(new Date(obj.start).getTime()).fromNow();
            res.status(200).send(JSON.stringify(obj,null,4));
	});
    else
	res.status(500).send({error : "no redis connection"});
});

// mac address lookup
app.all('/mac/:mac', function(req, res) {
    // trim the req
    var mac = req.params.mac;
    mac = mac.replace(/-/g,'');
    mac = mac.replace(/:/g,'');
    if (mac.length>6) {
	mac = mac.substr(0,6)
    }

    db.hgetall("mac:"+mac, function(err, obj) {
	if (err) 
	    obj = {error : err};
	else if (!obj)
	    obj = {error : "not found"};

	obj['ts'] = Date.now();
	obj['mac'] = mac;
	res.type('application/json');
	res.status(200).send(obj);
	incstat('maclookup', utils.getip(req));
    });
});

var handlegeo = function(req, res, ip) {
    debug("geolookup for " + ip);
 
    var handler = function(error, stdout, stderr) {
	if (error !== null) {
	    debug('exec error: ' + error);
	    debug('stderr: ' + stderr);
	    res.status(500).send({ error : 'lookup failed: ' + error});
	    incstat('error', ip);
	    return;
	}

	var obj = {};
	obj['ts'] = Date.now();
	obj['ip'] = ip;

	_.each(stdout.split('\n'), function(l) {
	    var tmp = l.split(':');
	    if (tmp.length < 2)
		return;

	    if (tmp[0].indexOf('Country Edition')>=0 && 
		tmp[1].indexOf('IP Address not found') < 0) 
	    {
		tmp = tmp[1].trim().split(',')
		obj.cc = tmp[0].trim();
		obj.country = tmp[1].trim();
	    } else if (tmp[0].indexOf('ISP Edition')>=0 && 
		       tmp[1].indexOf('IP Address not found') < 0) 
	    {
		obj.isp = tmp[1].trim();
	    } else if (tmp[0].indexOf('Organization Edition')>=0 && 
		tmp[1].indexOf('IP Address not found') < 0) 
	    {
		obj.org = tmp[1].trim();
	    } else if (tmp[0].indexOf('City Edition, Rev 1')>=0 && 
		tmp[1].indexOf('IP Address not found') < 0) 
	    {
		tmp = tmp[1].trim().split(',')
		obj.city = tmp[2].trim();
		obj.lat = parseFloat(tmp[4].trim());
		obj.lon = parseFloat(tmp[5].trim());
	    }
	});

	// get whois data
	whois.lookup(ip, function(err, data) {
	    if (!err && data)
		obj.whois = utils.parsewhois(data);

	    // reverse dnsname for the IP
	    exec('host ' + ip, function(error, stdout, stderr) {
		if (!error && stdout && stdout.indexOf('not found')<0) {
		    var tokens = stdout.trim().split(' ');
		    obj.dnsname = (tokens.lenght > 1 ? 
				   tokens[tokens.length-1] : 
				   undefined);
		}
		res.status(200).send(obj);
		incstat('geolookup', ip);
	    });
	});
    }
    
    if (!ip || ip.length<=0 || ip === "127.0.0.1") {
	res.status(500).send({ error : 'invalid ip: ' + ip});
	incstat('error', ip);

    } else if (ipaddr.IPv4.isValid(ip)) {
	exec('geoiplookup ' + ip, handler);  

    } else if (ipaddr.IPv6.isValid(ip)) {
	exec('geoiplookup6 ' + ip, handler);

    } else {
	res.status(500).send({ error : 'invalid ip: ' + ip });
	incstat('error', ip);
    }
};

// resolve client's public IP (req.ip)
app.all('/geo', function(req, res){
    return handlegeo(req, res, utils.getip(req));
});

// resolve any requested IP
//app.all('/geo/:ip', function(req, res){
//    return handlegeo(req, res, req.params.ip);
//});

// build sanitized sys exec command string
var buildcmd = function(cmd, args, tail) {
    cmd += ' ';
    cmd += _.map(args, function(v,k) {
	var tmp = '-'+k+' '+v;
	return "'" + tmp.replace(/'/g,"\'") + "'";
    }).join(' ');

    if (tail)
	cmd += ' ' + tail;

    return cmd.replace(/\s+/g, ' ');
}

// run reverse traceroute (to req.ip)
app.all('/mtr', function(req, res) {
    var ip = utils.getip(req);
    var cmd = buildcmd('mtr',req.query,'--raw '+ip); 
    debug(cmd);

    if (curr_mtr >= MAX_MTR) {
	debug('rejecting mtr request from ' + ip);
	res.status(503).send({error : "too many concurrent requests"});
	incstat('limerror', ip);
	return;
    }

    var result = {
	ts : Date.now(),
	cmd : 'mtr',
	cmdline : cmd,
	os : os.platform()
    };

    curr_mtr += 1;
    exec(cmd, function(err, stdout, stderr) {
	curr_mtr -= 1;
	if (err || !stdout || stdout.length < 1) {
	    result.error = { 
		type : 'execerror',
		message : stderr || stdout,
		code : err
	    };
	} else {
	    var r = {
		dst: ip,
		nqueries : (req.query.c ? parseInt(req.query.c) : 10),
		hops: []
	    };

	    var lines = (stdout ? stdout.trim() : "").split("\n");
	    for (var i = 0; i < lines.length; i++) {
		var tmp = lines[i].trim().split(' ');
		var hopid = parseInt(tmp[1]);
		switch (tmp[0]) {
		case 'h':
		    r.hops[hopid] = { 
			address : tmp[2],
			hostname : undefined, 
			missed : r.nqueries, 
			rtt : [] 
		    };
		    break;

		case 'p':
		    var hop = r.hops[hopid];
		    hop.missed -= 1;
		    hop.rtt.push(parseInt(tmp[2])/1000.0);
		    break;

		case 'd':
		    var hop = r.hops[hopid];
		    hop.hostname = tmp[2];
		    break;
		}
	    }
	    // did we reach the destination ?
	    r.succ = (r.hops.length > 0 && 
		      (r.hops[r.hops.length-1].address === r.dst ||
		       r.hops[r.hops.length-1].hostname === r.dst));

	    // trim off the last dupl hop (if succ)
	    if (r.hops.length > 1 && 
		(r.hops[r.hops.length-1].address === 
		 r.hops[r.hops.length-1].address)) 
	    {
		r.hops = r.hops.slice(0,r.hops.length-1)
	    }
	    result.result = r;
	}
	res.status(200).send(result);
	incstat('revmtr', ip);
    }); // exec
});

// run reverse ping (to req.ip)
app.all('/ping', function(req, res) {
    // default param for number of pings
    if (!req.query.c)
	req.query.c = 5;

    var ip = utils.getip(req);
    var cmd = buildcmd('ping',req.query,ip); 
    debug(cmd);

    if (curr_mtr >= MAX_PING) {
	debug('rejecting ping request from ' + ip);
	res.status(503).send({error : "too many concurrent requests"});
	incstat('limerror', ip);
	return;
    }

    var result = {
	ts : Date.now(),
	cmd : 'ping',
	cmdline : cmd,
	os : os.platform()
    };

    curr_ping += 1;
    exec(cmd, function(err, stdout, stderr) {
	curr_ping -= 1;
	if (err || !stdout || stdout.length < 1) {
	    result.error = { 
		type : 'execerror',
		message : stderr || stdout,
		code : err
	    };
	} else {
	    var lines = (stdout ? stdout.trim() : "").split("\n");
	    var r = {
		dst: ip,
		dst_ip : ip,
		count : req.query['c'],        // -c
		bytes : req.query['b'] || 56,  // -b or default
		ttl : req.query['t'], 
		lost : 0,                       // lost pkts
		rtt : [],                       // results
		stats : undefined,              // rtt stats
		time_exceeded_from : undefined, // IP of sender
		alt : []                        // full responses
	    };

	    var i, line;
	    for (i = 0; i < lines.length; i++) {	    
		line = lines[i].trim().replace(/\s+/g, ' ').split(' ');

		if (lines[i].toLowerCase().indexOf('time to live exceeded')>=0) {
		    r.time_exceeded_from = line[1];
		    break;
		    
		} else if (line[0] === 'PING') {
		    r.dst_ip = line[2].replace(/\(|\)|:/gi, '');
		    r.bytes = parseInt((line[3].indexOf('\(') < 0 ? line[3] : line[3].substring(0,line[3].indexOf('\('))));

		} else if (line[1] === 'bytes') {
		    for (var j = 2; j < line.length; j++) {
			if (line[j].indexOf('time=') === 0) {
			    var tmp = line[j].split('=');
			    r.rtt.push(parseFloat(tmp[1]));
			}
		    }
		}
	    }
	    result.result = r;
	}
	res.status(200).send(result);
	incstat('revping', ip);
    }); // exec
});

// websocket ping
app.ws('/wsping', function(ws, req) {
    var ip = utils.getip(req);
    var tr = new utils.TS();
    incstat('wsping', ip);
    debug("wsping req from " + ip);

    ws.on('message', function(msg) {
	msg = JSON.parse(msg);
	msg.r = tr.getts();
	msg.ra = ip;
	ws.send(JSON.stringify(msg), function(err) {
	    if (err)
		debug('wsping send failed: ' + err);
	});
    });
});

// startup
var server = app.listen(port, function() {
    debug("listening on %s:%d",
          server.address().address, server.address().port);
});
