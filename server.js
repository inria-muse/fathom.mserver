var debug = require('debug')('mserver')
var _ = require('underscore');
var argv = require('minimist')(process.argv.slice(2));
var redis = require('redis');
var express = require('express');
var bodyParser = require('body-parser');
var ipaddr = require('ipaddr.js');
var exec = require('child_process').exec;
var whois = require('node-whois');
var utils = require('utils');
var os = require('os');

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
		if (!error && stdout) {
		    var tokens = stdout.trim().split(' ');
		    obj.dnsname = (tokens.lenght > 1 ? tokens[tokens.length-1] : undefined);
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
app.all('/tr', function(req, res){
    var cmd = 'mtr'; 
    cmd += _.map(req.params, function(v,k) {
	return '-'+k+' '+v;
    }).join(' ');
    if (cmd.indexOf('[;,$]')) {
	res.status(500).send({ error : 'invalid request'});
    }
    cmd += ' ' + req.ip;

    exec(cmd, function(err, stdout, stderr) {
    });
});

// run reverse ping (to req.ip)
app.all('/ping', function(req, res){
    var cmd = 'ping'; 
    if (!req.params.c)
	req.params.c = 5;

    cmd += _.map(req.params, function(v,k) {
	return '-'+k+' '+v;
    }).join(' ');
    if (cmd.indexOf('[;,$]')) {
	res.status(500).send({ error : 'invalid request'});
    }
    cmd += ' ' + req.ip;

    var result = {
	ts : Date.now(),
	cmd : 'ping',
	cmdline : cmd,
	os : os.platform(),
	result : undefined
    };

    var child = exec(cmd, function(err, stdout, stderr) {
	if (err || !stdout || stdout.length < 1) {
	    result.error = { 
		type : 'execerror'
		message : stderr || stdout,
		code : err,
		cmd : 'ping'
	    };
	} else {
	    var lines = (stdout ? stdout.trim() : "").split("\n");
	    var r = {
		dst: req.ip,
		dst_ip : req.ip,
		count : req.params['c'],        // -c
		bytes : req.params['b'],        // -b or default
		ttl : req.params['t'], 
		lost : 0,                       // lost pkts
		rtt : [],                       // results
		stats : undefined,              // rtt stats
		time_exceeded_from : undefined, // IP of sender
		alt : []                        // full responses
	    };

	    for (var i = 0; i < lines.length; i++) {	    
		var line = lines[i].trim().replace(/\s+/g, ' ').split(' ');
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
    });
});


// startup
var server = app.listen(port, function() {
    debug("listening on %s:%d",
          server.address().address, server.address().port);
});
