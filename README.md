# Fathom MSERVER

Node REST API to support various lookups and reverse measurements
for Fathom extension.

## Dependencies

$ apt-get install geoip-bin libgeoip1 redis-server 
$ npm install pm2@latest -g

## Running

The app is managed by pm2 ('pm2 start processes.json' or 'npm start').

Run 'pm2 save' to store the currently running apps so that they will be 
restarted upon reboot.



## What's my IP

Return the client public IP and reverse DNS host name.

	GET|POST http://server<:port>/ip/	
	
### Example Request/Respose

	wget -q -O- http://localhost:3000/ip | python -mjson.tool
	{
	    "ip": "127.0.0.1",
	    "result": "localhost",
	    "ts": 1439816776789
	}

## Whois

Whois lookup of given IP, or if missing, the client public IP.

	GET|POST http://server<:port>/whois/<ip>	
	
### Example Request/Respose

	wget -q -O- http://localhost:3000/whois/128.93.165.1 | python -mjson.tool
	{
	    "ip": "127.0.0.1",
	    "result": {
	        "asblock": { ... },
	        "netblock": { ... }
	    },
	    "ts": 1439817132343
	}

## Mac address lookup

The API server reads once a day the latest OUI database from IEEE,
 
http://standards.ieee.org/develop/regauth/oui/oui.txt 

, and provides a simple REST API for mapping MAC addresses to device 
manufacturer information.

### Example Request/Respose

	$ wget -q -O- --method=GET http://localhost:3000/mac/406c8f | python -mjson.tool
	{
	  'req-ts'   : <request timestamp>,
	  'db-ts'    : <last database update timestamp>,
	  'oui'      : "xxxxxx",
	  'company'  : "Company Inc",
	  'address1' : "",              # first address line
	  <...>
	  'addressX' : "",              # last address line before country
	  'country'  : "United States"  # last address line
	}

## Traceroute

Run traceroute to the requested IP, or if missing, to the client (public) IP.

	GET|POST http://server<:port>/mtr/<host>	

### Example Request/Respose

	$ wget -q -O- --method=GET http://localhost:3000/mtr/128.93.165.1 | python -mjson.tool
	{
		"ts" : 1406894147226,
		"ip" : "127.0.0.1",
		"results" : { ... }
	}

## Ping

Run ping tot he requested IP/host, or if missing, to the client (public) IP.

	GET|POST http://server<:port>/ping/<host>

### Example Request/Response

	wget -q -O- --method=GET http://localhost:3000/ping/www.google.com | python -mjson.tool
	{
	    "ip": "127.0.0.1",
	    "result": {
	        "bytes": 56,
	        "cmd": "ping",
	        "cmdline": "ping '-c 5' www.google.com",
	        "count": 5,
	        "dst": "www.google.com",
	        "dst_ip": "74.125.195.147",
	        "lost": 0,
	        "rtt": [
	            7.464,
	            7.821,
	            7.455,
	            9.315,
	            7.539
	        ]
	    },
	    "ts": 1439826786536
	}


## Geolocation

The geolocation is based on a locally installed MaxMind DB (lite by default 
on linux, on muse we have a purchazed full db from 2011). The DB access is 
by using the commandline 'geoiplookup[6]' tool. If no IP address is given,
the service responds with the geolocation of the public IP of the request.

### Example Request/Respose

	$ wget -q -O- --method=GET http://localhost:3000/geo/128.93.165.1 | python -mjson.tool
	{
		"ts"  : 1406894147226,
		"ip" : "127.0.0.1",
		"result" : {
			"cc" : "FR",
			"country" : "France"
		}
	}

