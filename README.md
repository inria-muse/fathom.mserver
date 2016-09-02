# Fathom MSERVER

Node REST API to support various lookups and reverse measurements
for Fathom extension.


## Dependencies

$ apt-get install geoip-bin libgeoip1 redis-server 
$ npm install pm2@latest -g

## Prerequisites

Before first start, make sure you've cached the OUI (MAC address DB) to redis. To do this, do:

$ cd scripts; cat oui.txt | DEBUG=* node build-cache.js

## Running

The app is managed by pm2 ('pm2 start processes.json' or 'npm start').
Use the processes.devel.json when testing locally.

Run 'pm2 save' to store the currently running apps so that they will be 
restarted upon reboot.


## Server status

   GET http://server<:port>/status

## What's my IP

Return the client public IP and reverse DNS host name.

	GET|POST http://server<:port>/ip/	
	
### Example Request/Respose

	wget -q -O- http://localhost:3004/ip | python -mjson.tool
	{
	    "ip": "127.0.0.1",
	    "result": "localhost",
		"serverinfo": {
	        "geo": {
	            "cc": "FR",
	            "country": "France",
	            "ip": "128.93.62.39"
	        },
	        "hostname": "Quadstation-Linux",
	        "ipv4": "128.93.62.39"
	    },    
	    "ts": 1439816776789
	}


## Whois

Whois lookup of given IP, or if missing, the client public IP.

	GET|POST http://server<:port>/whois/<ip>	
	
### Example Request/Respose

	wget -q -O- http://localhost:3004/whois/128.93.165.1 | python -mjson.tool
	{
	    "ip": "127.0.0.1",
	    "result": {
	        "asblock": { ... },
	        "netblock": { ... }
	    },
		"serverinfo": {
	        "geo": {
	            "cc": "FR",
	            "country": "France",
	            "ip": "128.93.62.39"
	        },
	        "hostname": "Quadstation-Linux",
	        "ipv4": "128.93.62.39"
	    },    
	    "ts": 1439817132343
	}


## Mac address lookup

MAP MAC addresses to device manufacturer information based on info at:

http://standards.ieee.org/develop/regauth/oui/oui.txt 

The OUI data is cached in Redis db, make sure to update the source file and run 

$ node/scripts/build-cache.js < script/oui.txt 


### Example Request/Respose

	$ wget -q -O- --method=GET http://localhost:3004/mac/406c8f | python -mjson.tool
	{
	    "ip": "127.0.0.1",
	    "result": {
	        "address1": "1 Infinite Loop",
	        "address2": "Cupertino CA 95014",
	        "company": "Apple",
	        "country": "UNITED STATES",
	        "ts": "1410634631825"
	    },
	    "ts": 1440055578862
	}


## Traceroute

Run traceroute to the requested IP, or if missing, to the client (public) IP.If geo=true, 
returns the geo-location of each hop.

	GET|POST http://server<:port>/mtr/<host>(?geo=true)

### Example Request/Respose

	$ wget -q -O- --method=GET http://localhost:3004/mtr/88.173.211.195?geo=true | python -mjson.tool
	{
	    "ip": "127.0.0.1",
	    "result": {
	        "cmd": "mtr",
	        "cmdline": "mtr '-c 3' '-n' --raw 88.173.211.195",
	        "dst": "88.173.211.195",
	        "hops": [
	            {
	                "address": "128.93.1.100",
	                "geo": {
	                    "cc": "FR",
	                    "country": "France",
	                    "ip": "128.93.1.100"
	                },
	                "missed": 0,
	                "rtt": [
	                    1.544,
	                    1.53,
	                    1.336
	                ]
	            },
	            {
	                "address": "192.93.1.105",
	                "geo": {
	                    "cc": "FR",
	                    "country": "France",
	                    "ip": "192.93.1.105"
	                },
	                "missed": 0,
	                "rtt": [
	                    1.731,
	                    1.672,
	                    1.564
	                ]
	            },
	            ...
	            {
	                "address": "88.173.211.195",
	                "geo": {
	                    "cc": "FR",
	                    "country": "France",
	                    "ip": "88.173.211.195"
	                },
	                "missed": 0,
	                "rtt": [
	                    24.294,
	                    23.647,
	                    23.736
	                ]
	            }	              
	         ],
	        "nqueries": 3,
	        "success": true
	    },
	    "serverinfo": {
	        "geo": {
	            "cc": "FR",
	            "country": "France",
	            "ip": "128.93.62.39"
	        },
	        "hostname": "Quadstation-Linux",
	        "ipv4": "128.93.62.39"
	    },
	    "ts": 1444294738558
	}


## Ping

Run ping to the requested IP/host, or if missing, to the client (public) IP. If geo=true, 
returns the geo-location of the sources and destination IPs.

	GET|POST http://server<:port>/ping/<host>(?geo=true)

### Example Request/Response

	wget -q -O- --method=GET http://localhost:3004/ping/www.google.com?geo=true | python -mjson.tool
	{
	    "ip": "127.0.0.1",
	    "result": {
	        "bytes": 56,
	        "cmd": "ping",
	        "cmdline": "ping '-c 5' www.google.com",
	        "count": 5,
	        "dst": "www.google.com",
	        "dst_ip": "74.125.195.99",
	        "geo": {
	            "cc": "US",
	            "country": "United States",
	            "ip": "74.125.195.99"
	        },
	        "lost": 0,
	        "rtt": [
	            7.89,
	            8.06,
	            7.88,
	            7.91,
	            7.79
	        ]},
	    "serverinfo": {
	        "geo": {
	            "cc": "FR",
	            "country": "France",
	            "ip": "128.93.62.39"
	        },
	        "hostname": "Quadstation-Linux",
	        "ipv4": "128.93.62.39"
	    },
	    "ts": 1444294225024
	}


## Geolocation

The geolocation is based on a locally installed MaxMind DB (lite by default 
on linux, on muse we have a purchazed full db from 2011). The DB access is 
by using the commandline 'geoiplookup[6]' tool. If no IP address is given,
the service responds with the geolocation of the public IP of the request.

	GET|POST http://server<:port>/geo/<host>

### Example Request/Respose

	$ wget -q -O- --method=GET http://localhost:3004/geoip/128.93.165.1 | python -mjson.tool
	{
	    "ip": "127.0.0.1",
	    "result": {
	        "cc": "FR",
	        "country": "France",
	        "ip": "128.93.165.1"
	    },
	    "serverinfo": {
	        "geo": {
	            "cc": "FR",
	            "country": "France",
	            "ip": "128.93.62.39"
	        },
	        "hostname": "Quadstation-Linux",
	        "ipv4": "128.93.62.39"
	    },
	    "ts": 1444294291264
	}	
