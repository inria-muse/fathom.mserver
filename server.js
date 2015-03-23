var os = require('os');
var exec = require('child_process').exec;

var debug = require('debug')('mserver')
var _ = require('underscore');
var argv = require('minimist')(process.argv.slice(2));
var redis = require('redis');
var express = require('express');
var bodyParser = require('body-parser');
var ipaddr = require('ipaddr.js');
var whois = require('node-whois');

var utils = require('./utils');

if (argv.h) {
    console.log("Usage: " + process.argv[0] + 
		" " + process.argv[1] + 
		" [-p <port>]");
    process.exit(0);
}

var port = argv.p || 3000;

// redis client
var db = redis.createClient();
db.on("error", function (err) {
    debug("redis error: " + err);
});

// main app
var app = express();

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
});

// routes
app.all('/mac/:mac', function(req, res){
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
    });
});

var handlegeo = function(req, res, ip) {
    debug("geolookup for " + ip);
 
    var handler = function(error, stdout, stderr) {
	if (error !== null) {
	    debug('exec error: ' + error);
	    debug('stderr: ' + stderr);
	    res.send(500, { error : 'lookup failed: ' + error});
	    return;
	}

	var obj = {};
	obj['ts'] = Date.now();
	obj['ip'] = ip;

	_.each(stdout.split('\n'), function(l) {
	    var tmp = l.split(':');
	    if (tmp[0].indexOf('Country Edition')>=0) {
		if (tmp[1] && tmp[1].indexOf('IP Address not found') < 0) {
		    tmp = tmp[1].trim().split(',')
		    obj.cc = tmp[0].trim();
		    obj.country = tmp[1].trim();
		} // else not found
	    } else if (tmp[0].indexOf('ISP Edition')>=0) {
		obj.isp = tmp[1].trim();
	    } else if (tmp[0].indexOf('Organization Edition')>=0) {
		obj.org = tmp[1].trim();
	    } else if (tmp[0].indexOf('City Edition, Rev 1')>=0) {
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
	    });
	});
    }
    
    if (!ip || ip.length<=0 || ip === "127.0.0.1") {
	res.status(500).send({ error : 'invalid ip: ' + ip});
    } else if (ipaddr.IPv4.isValid(ip)) {
	exec('geoiplookup ' + ip, handler);  
    } else if (ipaddr.IPv6.isValid(ip)) {
	exec('geoiplookup6 ' + ip, handler);
    } else {
	res.status(500).send({ error : 'invalid ip: ' + ip });
	return;
    }
};

// resolve client's public IP (req.ip)
app.all('/geo', function(req, res){
    return handlegeo(req, res, req.ip);
});

// resolve any requested IP
//app.all('/geo/:ip', function(req, res){
//    return handlegeo(req, res, req.params.ip);
//});

// run reverse traceroute (to req.ip)
app.all('/mtr', function(req, res){
    var cmd = 'mtr '; 

    cmd += _.map(req.query, function(v,k) {
	var tmp = '-'+k+' '+v;
	return "'" + tmp.replace(/'/g,"\'") + "'";
    }).join(' ');
    cmd += ' --raw ' + req.ip;

    var result = {
	ts : Date.now(),
	cmd : 'mtr',
	cmdline : cmd,
	os : os.platform()
    };

    exec(cmd, function(err, stdout, stderr) {
	if (err || !stdout || stdout.length < 1) {
	    result.error = { 
		type : 'execerror',
		message : stderr || stdout,
		code : err
	    };
	} else {
	    var r = {
		dst: req.ip,
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
    }); // exec
});

// run reverse ping (to req.ip)
app.all('/ping', function(req, res){
    var cmd = 'ping '; 

    if (!req.query.c)
	req.query.c = 5;

    cmd += _.map(req.query, function(v,k) {
	var tmp = '-'+k+' '+v;
	return "'" + tmp.replace(/'/g,"\'") + "'";
    }).join(' ');
    cmd += ' ' + req.ip;

    var result = {
	ts : Date.now(),
	cmd : 'ping',
	cmdline : cmd,
	os : os.platform()
    };

    exec(cmd, function(err, stdout, stderr) {
	if (err || !stdout || stdout.length < 1) {
	    result.error = { 
		type : 'execerror',
		message : stderr || stdout,
		code : err
	    };
	} else {
	    var lines = (stdout ? stdout.trim() : "").split("\n");
	    var r = {
		dst: req.ip,
		dst_ip : req.ip,
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
    }); // exec
});

// startup
var server = app.listen(port, function() {
    debug("listening on %s:%d",
          server.address().address, server.address().port);
});
