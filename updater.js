var request = require('request');
var cheerio = require('cheerio');
var child_process = require('child_process');
var nodemailer = require("nodemailer");
var fs = require('fs');
var _ = require('underscore');

var scrapePage = function(html) {

	$ = cheerio.load(html);

    var $wrapper = $('#news_wrapper');
    var $articles = $wrapper.find('.news_article').find('.article_content_margin');

    var $firstArticle = $articles.find('h1:contains("SPOTREP")').closest('.article_content_margin');

    var $header = $firstArticle.children().find('h1');

    var headerHtml = $header.html().trim();
    var contextText = $firstArticle.children('.post_content').children().first().text();

    if ($header) {

        var state = {
            header: headerHtml,
		    content: contextText
	    };

        fs.exists('./state.json', function(exists) {
	        if (exists) {
		        fs.readFile('./state.json', function(err, data) {
			        if (err) throw err;

			        var stateFile = JSON.parse(data);

		            var changed = JSON.stringify(state) !== JSON.stringify(stateFile);

                    if (changed) {
                        handleUpdate(state);

                        //fs.writeFileSync('./state.json', JSON.stringify(state));   
                    }
		        });
	        } else {
		        fs.writeFileSync('./state.json', JSON.stringify(state));
	        }
        });
        
    }

};

var handleUpdate = function(state) {

    var $header = $('a', state.header);

    fs.writeFileSync('./updatingState.json', JSON.stringify(state));

    var options = config.steamcmd;
    var steamcmd = child_process.spawn(options.path + '\\steamcmd.exe', ['+login', options.auth.user, options.auth.pass, '+force_install_dir', options.gamepath, '+"app_update ' + options.appid + '"', 'validate', '+quit']);

    steamcmd.stdout.on('data', function (data) {
      console.log('stdout: ' + data);
    });

    steamcmd.stderr.on('data', function (data) {
      console.log('stderr: ' + data);
    });

    steamcmd.on('close', function (code) {
        console.log('child process exited with code ' + code);

        fs.unlink('./updatingState.json', function (err) {
            if (err) throw err;
        });
    });

    handleSendNotification($header);

};

var handleSendNotification = function($header) {

    request($header.attr('href'), function(err, resp, body) {
		if (err)
			throw err;

		$ = cheerio.load(body);

        var $wrapper = $('#post_text_wrapper');
		
        var transport = nodemailer.createTransport("SMTP", config.nodemailer.transport);

        var options = {
            subject: "Arma 3 Updated: " + $header.attr('title'), // Subject line
            text: $wrapper.text(), // plaintext body
            html: $header.toString() + $wrapper.html() // html body
        };

        var emailOptions = _.extend(config.nodemailer.options, options); 

        // send mail with defined transport object
        /*transport.sendMail(emailOptions, function(error, response){
            if(error){
                console.log(error);
            }else{
                console.log("Message sent: " + response.message);
            }

            transport.close(); // shut down the connection pool, no more messages
        });*/

	});

};

var scrapeUrl = function(url) {

	request(url, function(err, resp, body) {
		if (err)
			throw err;
		$ = cheerio.load(body);
		scrapePage(body);
	});

};

var config = {};

fs.exists('./config.json', function(exists) {
    if (exists) {

        fs.readFile('./config.json', function(err, data) {
			if (err) throw err;

			config = JSON.parse(data);
		});

    }
});

fs.exists('./updatingState.json', function(exists) {
    if (!exists) {
        var startUrl = 'http://dev.arma3.com/';
        scrapeUrl(startUrl);
    }
});