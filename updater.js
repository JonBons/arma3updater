var async = require('async');
var request = require('request');
var cheerio = require('cheerio');
var child_process = require('child_process');
var nodemailer = require("nodemailer");
var fs = require('fs');
var path = require('path');
var serviceManager = require('windows-service-manager');
var gamedig = require('gamedig');
var _ = require('underscore');

var util = require('util');
var log_file = fs.createWriteStream('debug.log', {
    flags: 'w'
});
var log_stdout = process.stdout;

console.log = function(d) { //
    log_file.write(util.format(d) + '\n');
    log_stdout.write(util.format(d) + '\n');
};

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
                        console.log('Server needs updating!');

                        handleUpdate(state);

                        fs.writeFileSync('./state.json', JSON.stringify(state));
                    } else {
                        console.log('Server is already updated!');
                    }
                });
            } else {
                fs.writeFileSync('./state.json', JSON.stringify(state));
            }
        });

    }

};

var handleInstanceShutdown = function(instance, playercount, callback) {

    if (playercount < 1) {

        serviceManager.stopService(instance.service, 5, true, function(error, services) {
            if (!error) {
                console.log('Stopped service ' + instance.service);
                callback();
            } else {
                if (error.code == 1060) {
                    console.log('Service ' + instance.service + ' does not exist...');
                    callback();
                } else {
                    console.log('Error stopping service ', error);
                }
            }
        });

    }

};

var handleUpdate = function(state) {

    var $header = $('a', state.header);

    fs.writeFileSync('./updatingState.json', JSON.stringify(state));

    async.forEach(config.instances, function(instance, callback) {
        gamedig.query({
                type: 'gamespy3',
                host: instance.ip,
                port: instance.port
            },
            function(state) {
                if (state.error) {
                    callback();
                }

                if (state.raw) {
                    handleInstanceShutdown(instance, Number(state.raw.numplayers), callback);
                }
            }
        );
    }, function(err) {
        if (err) return console.log(err);

        var options = config.steamcmd;
        var args = ['+login', options.auth.user, options.auth.pass, '+force_install_dir', options.gamepath, '+app_update', options.appid, 'validate', '+quit'];

        var steamcmd = child_process.spawn(options.path + '\\steamcmd.exe', args);

        //console.log(options.path + '\\steamcmd.exe', args);

        steamcmd.stdout.on('data', function(data) {
            console.log('stdout: ' + data);
        });

        steamcmd.stderr.on('data', function(data) {
            console.log('stderr: ' + data);
        });

        steamcmd.on('close', function(code) {
            console.log('child process exited with code ' + code);

            setTimeout(function() {

                if (code == 0) {

                    async.forEach(config.instances, function(instance, callback) {

                        var dataFolder = options.gamepath + '\\';
                        fs.readdir(dataFolder, function(err, files) {
                            if (err) throw err;

                            files.map(function(file) {
                                return path.join(dataFolder, file);
                            }).filter(function(file) {
                                return fs.statSync(file).isFile();
                            }).forEach(function(file) {

                                var instanceFile = file.replace('arma3_data', 'am1\\arma3_' + instance.port);

                                var oldFile = fs.createReadStream(file);
                                var newFile = fs.createWriteStream(instanceFile);

                                oldFile.pipe(newFile);

                            });

                            setTimeout(function() {

                                serviceManager.startService(instance.service, 10, function(error, services) {
                                    if (!error) {
                                        console.log('Started service ' + instance.service);
                                    }
                                });

                            }, 2000);
                        });

                    });

                }

                fs.unlink('./updatingState.json', function(err) {
                    if (err) throw err;
                });

            }, 500);

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
        transport.sendMail(emailOptions, function(error, response) {
            if (error) {
                console.log(error);
            } else {
                console.log("Message sent: " + response.message);
            }

            transport.close(); // shut down the connection pool, no more messages
        });

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
    } else {
        console.log('Server is already updating or is in a funky state!');
    }
});
