var debug = require('debug')('server')
var _ = require('underscore');
var argv = require('minimist')(process.argv.slice(2));
var redis = require('redis');
var express = require('express');
var bodyParser = require('body-parser');
var ipaddr = require('ipaddr.js');
var exec = require('child_process').exec;

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
	res.status(200).send(obj);
    }

    if (!ip || ip.length<=0 || ip === "127.0.0.1") {
	res.status(500).send({ error : 'invalid ip: ' + ip});
    } else if (ipaddr.IPv4.isValid(ip)) {
	var child = exec('geoiplookup ' + ip, handler);  
    } else if (ipaddr.IPv6.isValid(ip)) {
	var child = exec('geoiplookup6 ' + ip, handler);
    } else {
	res.status(500).send({ error : 'invalid ip: ' + ip });
	return;
    }
};

app.all('/geo', function(req, res){
    return handlegeo(req, res, req.ip);
});

app.all('/geo/:ip', function(req, res){
    return handlegeo(req, res, req.params.ip || req.ip);
});

// startup
var server = app.listen(port, function() {
    debug("listening on %s:%d",
          server.address().address, server.address().port);
});
