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
 * @fileoverfiew REST API for various measurement tools and lookups.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

// external dependencies
var debug = require('debug')('fathom.mserver')
var _ = require('underscore');
var redis = require('redis');
var express = require('express');
var bodyParser = require('body-parser');
var moment = require("moment");
var cors = cors = require('cors');

var tools = require('./tools');
var utils = require('./utils');

// server listening port
const PORT = parseInt(process.env.PORT) || 3000;

const MAX_WORKER_PROCS = parseInt(process.env['MAX_WORKER_PROCS']) || 500;
var curr_procs = 0; // watching per worker

// max simultaneous reqs per IP (across cluster)
const MAX_PER_IP = parseInt(process.env['MAX_PER_IP']) || 10;

// requests per hour per IP (across cluster)
const REQS_PER_IP = parseInt(process.env['REQS_PER_IP']) || 30;
const REQS_PER_IP_IV = 3600; // 1h in seconds

// redis client
var db = redis.createClient();
if (!db) {
    debug("redis create failed");
    process.exit(1);
}
db.on("error", function (err) {
    debug("redis connect or fatal error: " + err);
    process.exit(1);
});

// runtime stats
var REDISOBJ = 'fathom_mserver';
db.hmset(REDISOBJ, {
    start : new Date(), // server starttime

    fulllookup : 0, // my ip lookups
    last_fulllookup : null,
    last_fulllookup_ip : null,

    iplookup : 0, // my ip lookups
    last_iplookup : null,
    last_iplookup_ip : null,

    geolookup : 0, // ip geolookups
    last_geolookup : null,
    last_geolookup_ip : null,

    whoislookup : 0, // my ip lookups
    last_whoislookup : null,
    last_whoislookup_ip : null,

    maclookup : 0, // mac address lookups
    last_maclookup : null,
    last_maclookup_ip : null,

    revping : 0, // reverse pings
    last_revping : null,
    last_revping_ip : null,

    revmtr : 0, // reverse traceroutes
    last_revmtr : null,
    last_revmtr_ip : null,

    error : 0, // total errors
    last_error : null,
    last_error_ip : null,

    limerror : 0, // hit max MTR/PING procs
    last_limerror : null,
    last_limerror_ip : null
});

var rediserr = function(err, res) {
	if (err) debug("redis error: " + err);
};

var checkiprates = function(cb, ip) {
	db.hgetall("ratelim:"+ip, function(err, obj) {
		var ts = Date.now();
		if (!obj)
			obj = {
				running : 0,
				hourstart : ts,
				hourruns : 0
			}
		else
			_.each(obj, function(v,k) { obj[k] = parseInt(v); } );

		if ((ts - obj['hourstart']) > REQS_PER_IP_IV*1000) {
			// next hour - reset rate lim
			obj['hourstart'] = ts;
			obj['hourruns'] = 0;
		}

		if (ip != '127.0.0.1' && obj['running'] > MAX_PER_IP) {
			cb(false); // too many concurrent requests from this IP
		} else if (ip != '127.0.0.1' && obj['hourruns'] > REQS_PER_IP) {
			cb(false); // too many reqs this hour
		} else {
			obj['running'] += 1;
			obj['hourruns'] += 1;
		    db.hmset("ratelim:"+ip, obj);
			cb(true);
		}
	});
};

var senderror = function(req, res, err) {
	err = err || { error : "internal server error" };
	err['ts'] = Date.now();
	err['ip'] = req.clientip;	

	var tmpobj = {};
    tmpobj["last_error"] = err['ts'];
    tmpobj["last_error_ip"] = err['ip'];
    db.hmset(REDISOBJ, tmpobj, rediserr);
    db.hincrby(REDISOBJ, 'error', 1, rediserr);
	db.hincrby("ratelim:"+req.clientip, 'running', -1, rediserr);

    res.type('application/json');
    res.status(200).send(JSON.stringify(err,null,4));
};

var sendresp = function(req, res, obj, what) {
    var tmpobj = {};
    tmpobj["last_"+what] = new Date();
    tmpobj["last_"+what+"_ip"] = req.clientip;
    db.hmset(REDISOBJ, tmpobj, rediserr);
    db.hincrby(REDISOBJ, what, 1, rediserr);
	db.hincrby("ratelim:"+req.clientip, 'running', -1, rediserr);

    res.type('application/json');
    res.status(200).send(obj);
};

//---- APP -----

// main app
var app = express();

// websocket end-point
var expressWs = require('express-ws')(app); 

// we'll be behind a proxy
app.enable('trust proxy');

// middleware
app.use(bodyParser.json());

// CORS
var whitelist = ['https://muse.inria.fr','http://muse.inria.fr'];
var corsOptions = {
  origin: function(origin, callback){
    var originIsWhitelisted = whitelist.indexOf(origin) !== -1;
    callback(null, originIsWhitelisted);
  }
};
app.use(cors());

// generic err handler
app.use(function(err, req, res, next) {
    debug(err);
    debug(err.stack);
    senderror(req,res);
});

// rate-limit heavier requests per worker
app.use(/\/ping|\/mtr/, function(req, res, next) {
    if (curr_procs >= MAX_WORKER_PROCS) {
    	debug("PANIC - too many jobs [" + curr_procs + "]");
		return res.status(503).send();
    } else {
    	next();
    }
});

// ip checking and rate limits per IP for all requests (except wsping)
app.use(function(req, res, next) {    
	var ip = (req.headers['x-forwarded-for'] || 
	  		  req.connection.remoteAddress || 
	          req.socket.remoteAddress ||
	          req.connection.socket.remoteAddress ||
	          req.ip);
	ip = ip.replace('::ffff:','').trim();
	req.clientip = ip
	debug("connection from " + ip);

	if (req.path === '/wsping' || req.path === '/') {
		next();
	} else {
		checkiprates(function(ok) {
			debug("allowed? " + ok);
			if (ok) {
				next(); // pass control to the next handler 
			} else {
			    res.type('application/json');
			    res.status(200).send(JSON.stringify({ error : 'rate limited -- try again later' },null,4));			
			}
		}, ip);
	}
});

// returns some basic stats about the server
app.get('/', function(req, res) {
	db.hgetall(REDISOBJ, function(err, obj) {
        res.type('text/plain');
        obj.uptime = "Started " + moment(new Date(obj.start).getTime()).fromNow();
        res.status(200).send(JSON.stringify(obj,null,4));
	});
});

// return all possible info about the client based on IP
app.all('/fulllookup', function(req, res) {
	var obj = {
		'ts' : Date.now(),
		'ip' : req.clientip,
		'result'  : {}
	};

	tools.reverseDns(function(err, result) {
		if (err) {
		    senderror(req, res, err);
		    return;
		}
		obj.result['ip'] = result;

		tools.geo(function(err, result) {
			if (err) {
			    senderror(req, res, err);
			    return;
			}
			obj.result['geo'] = result;

			tools.whois(function(err, result) {
				if (err) {
				    senderror(req, res, err);
				    return;
				}
				obj.result['whois'] = result;

				sendresp(req, res, obj, 'fulllookup');

			}, obj['ip']);					
		}, obj['ip']);			
	}, obj['ip']);
});

// basic ip lookup
app.all('/ip', function(req, res) {
	var obj = {
		'ts' : Date.now(),
		'ip' : req.clientip,
		'result'  : undefined
	};

	tools.reverseDns(function(err, result) {
		if (err) {
		    senderror(req, res, err);
		} else {
			obj.result = result;
			sendresp(req, res, obj, 'iplookup');
		}
	}, obj['ip']);
});

// mac address lookup
app.all('/mac/:mac', function(req, res) {
	var obj = {
		'ts' : Date.now(),
		'ip' : req.clientip,
		'result'  : undefined
	};

    // trim the req
    var mac = req.params.mac.trim();
    mac = mac.replace(/-/g,'');
    mac = mac.replace(/:/g,'');
    if (mac.length>6) {
		mac = mac.substr(0,6)
    }

    db.hgetall("mac:"+mac, function(err, result) {
		if (err) {
		    senderror(req, res, {error : err});
		} else if (!result) {
		    senderror(req, res, {error : mac + ' not found'});
		} else {
			obj['result'] = result;
			sendresp(req, res, obj, 'maclookup');
		}
    });
});

// resolve client's geolocation (req.ip)
app.all('/geoip', function(req, res) {
	var obj = {
		'ts' : Date.now(),
		'ip' : req.clientip,
		'result'  : undefined
	};

	tools.geo(function(err, result) {
		if (err) {
		    senderror(req, res, err);
		} else {
			obj.result = result;
			sendresp(req, res, obj, 'geolookup');
		}
	}, obj['ip']);
});

// resolve any requested IP geolocation (req.params.ip)
app.all('/geoip/:ip', function(req, res) {
	var obj = {
		'ts' : Date.now(),
		'ip' : req.clientip,
		'result'  : undefined
	};
	tools.geo(function(err, result) {
		if (err) {
		    senderror(req, res, err);
		} else {
			obj.result = result;
			sendresp(req, res, obj, 'geolookup');
		}
	}, req.params.ip);
});

// whois client's public IP (req.ip)
app.all('/whois', function(req, res) {
	var obj = {
		'ts' : Date.now(),
		'ip' : req.clientip,
		'result'  : undefined
	};
	tools.whois(function(err, result) {
		if (err) {
		    senderror(req, res, err);
		} else {
			obj.result = result;
			sendresp(req, res, obj, 'whois');
		}
	}, obj['ip']);
});

// whois requested IP (req.params.ip)
app.all('/whois/:ip', function(req, res) {
	var obj = {
		'ts' : Date.now(),
		'ip' : req.clientip,
		'result'  : undefined
	};
	tools.whois(function(err, result) {
		if (err) {
		    senderror(req, res, err);
		} else {
			obj.result = result;
			sendresp(req, res, obj, 'whois');
		}
	}, req.params.ip);
});

// run reverse traceroute (to req.ip)
app.all('/mtr', function(req, res) {
	var obj = {
		'ts' : Date.now(),
		'ip' : req.clientip,
		'result'  : undefined
	};

    curr_procs += 1;
	tools.mtr(function(err, result) {
		curr_procs -= 1;
		if (err) {
		    senderror(req, res, err);
		} else {
			obj.result = result;
			sendresp(req, res, obj, 'revmtr');
		}
	}, obj['ip'], req.query);
});

// run reverse traceroute (to req.params.ip)
app.all('/mtr/:ip', function(req, res) {
	var obj = {
		'ts' : Date.now(),
		'ip' : req.clientip,
		'result'  : undefined
	};

    curr_procs += 1;
	tools.mtr(function(err, result) {
		curr_procs -= 1;
		if (err) {
		    senderror(req, res, err);
		} else {
			obj.result = result;
			sendresp(req, res, obj, 'revmtr');
		}
	}, req.params.ip, req.query);
});

// run reverse ping (to req.ip)
app.all('/ping', function(req, res) {
	var obj = {
		'ts' : Date.now(),
		'ip' : req.clientip,
		'result'  : undefined
	};

    curr_procs += 1;
	tools.ping(function(err, result) {
		curr_procs -= 1;
		if (err) {
		    senderror(req, res, err);
		} else {
			obj.result = result;
			sendresp(req, res, obj, 'revping');
		}
	}, obj['ip'], req.query);
});

// run reverse ping (to req.ip)
app.all('/ping/:ip', function(req, res) {
	var obj = {
		'ts' : Date.now(),
		'ip' : req.clientip,
		'result'  : undefined
	};

    curr_procs += 1;
	tools.ping(function(err, result) {
		curr_procs -= 1;
		if (err) {
		    senderror(req, res, err);
		} else {
			obj.result = result;
			sendresp(req, res, obj, 'revping');
		}
	}, req.params.ip, req.query);
});

// websocket ping
app.ws('/wsping', function(ws, req) {
    var ip = req.clientip;
    var tr = new utils.TS();
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
var server = app.listen(PORT, function() {
    debug("listening on %s:%d",
          server.address().address, server.address().port);
});
