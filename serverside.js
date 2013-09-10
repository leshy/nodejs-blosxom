// Generated by CoffeeScript 1.4.0
(function() {
  var Backbone, Wiki, async, collections, converter, crypto, decorate, decorators, ejs, ejslocals, env, express, fs, helpers, hound, http, init, initCollections, initDb, initExpress, initLogger, initRoutes, initRss, initWiki, makeLogDecorator, mongodb, pagedown, path, rfc822, settings, wraplog, xml, _,
    __slice = [].slice;

  path = require('path');

  fs = require('fs');

  crypto = require('crypto');

  async = require('async');

  _ = require('underscore');

  Backbone = require('backbone4000');

  mongodb = require('mongodb');

  http = require('http');

  express = require('express');

  ejs = require('ejs');

  ejslocals = require('ejs-locals');

  collections = require('collections/serverside');

  helpers = require('helpers');

  decorators = require('decorators');

  decorate = decorators.decorate;

  hound = require('hound');

  xml = require('xml');

  pagedown = require('pagedown');

  converter = new pagedown.Converter();

  env = {};

  rfc822 = require('./rfc822');

  settings = {
    postsfolder: "posts",
    privatetags: ["secret_tag", "secret_tag2"],
    users: {
      some_key: {
        user: 'username',
        tags: ["secret_tag"]
      }
    }
  };

  settings = helpers.extend(require('./settings').settings);

  settings.privatetags = helpers.arrayToDict(settings.privatetags);

  _.map(settings.users, function(userdata, key) {
    console.log(key, userdata);
    return userdata.tags = helpers.arrayToDict(userdata.tags);
  });

  console.log("setings:", JSON.stringify(settings));

  ejs.filters.prettyDate = function(obj) {
    return helpers.prettyDate(obj);
  };

  initLogger = function(env, callback) {
    env.log = function() {
      var data, json, taglist, tags, text;
      text = arguments[0], data = arguments[1], taglist = 3 <= arguments.length ? __slice.call(arguments, 2) : [];
      tags = {};
      _.map(taglist, function(tag) {
        return tags[tag] = true;
      });
      if (tags.error) {
        text = text.red;
      }
      if (tags.error && _.keys(data).length) {
        json = " " + JSON.stringify(tags.error);
      } else {
        json = "";
      }
      return console.log(String(new Date()).yellow + " " + _.keys(tags).join(', ').green + " " + text + json);
    };
    env.logres = function(name, callback) {
      return function(err, data) {
        if (err) {
          env.log(name + ': ' + err, {
            error: err
          }, 'init', 'fail');
        } else {
          env.log(name + "...", {}, 'init', 'ok');
        }
        return callback(err, data);
      };
    };
    env.log('logger initialized', {}, 'init', 'info');
    return callback();
  };

  initDb = function(callback) {
    env.db = new mongodb.Db('blog', new mongodb.Server('localhost', 27017), {
      safe: true
    });
    return env.db.open(callback);
  };

  initCollections = function(callback) {
    env.blog = new collections.MongoCollection({
      db: env.db,
      collection: 'blog'
    });
    env.post = env.blog.defineModel('post', {
      output: function(ignoretags) {
        if (!this.attributes.tags) {
          return {
            tags: []
          };
        }
        return {
          id: this.attributes.id,
          created: this.attributes.created,
          modified: this.attributes.modified,
          tags: _.without.apply(this, [_.keys(this.attributes.tags)].concat(ignoretags)),
          title: this.attributes.title,
          link: this.attributes.file,
          body: converter.makeHtml(this.attributes.body)
        };
      }
    });
    return callback();
  };

  initExpress = function(callback) {
    var app;
    env.app = app = express();
    return app.configure(function() {
      app.engine('ejs', ejslocals);
      app.set('view engine', 'ejs');
      app.set('views', __dirname + '/views');
      app.use(express.favicon());
      app.use(express.logger('dev'));
      app.use(express.bodyParser());
      app.use(express.methodOverride());
      app.use(app.router);
      app.use(express["static"](__dirname + '/static'));
      app.use(function(err, req, res, next) {
        env.log('web request error', {
          stack: err.stack
        }, 'error', 'http');
        return res.send(500, 'BOOOM!');
      });
      env.server = http.createServer(env.app);
      env.server.listen(3333);
      env.log('http server listening', {}, 'info', 'init', 'http');
      return callback(void 0, true);
    });
  };

  makeLogDecorator = function(name) {
    return function() {
      var args, callback, f;
      f = arguments[0], callback = arguments[1], args = 3 <= arguments.length ? __slice.call(arguments, 2) : [];
      return f(function(err, data) {
        if (!err) {
          env.log(name + ' ready', {}, 'info', 'init', 'done', name);
        } else {
          env.log(name + ' failed!', {}, 'info', 'init', 'error', name);
        }
        return callback(err, data);
      });
    };
  };

  wraplog = function(name, f) {
    return decorators.decorate(makeLogDecorator(name), f);
  };

  Wiki = Backbone.Model.extend4000({
    initialize: function() {
      var _this = this;
      return this.when('dir', function(dir) {
        _this.watchDir(dir);
        return _this.crawlDir(dir, function(file) {
          return _this.pingFile(file);
        });
      });
    },
    crawlDir: function(dir, callback) {
      var _this = this;
      return fs.readdir(dir, function(err, files) {
        if (err) {
          return;
        }
        return _.map(files, function(file) {
          var stat;
          if (!_this.checkIgnores(file)) {
            return;
          }
          file = path.normalize(dir + "/" + file);
          stat = fs.statSync(file);
          if (stat.isDirectory()) {
            _this.crawlDir(file, callback);
          }
          if (stat.isFile()) {
            return helpers.cbc(callback, file);
          }
        });
      });
    },
    checkIgnores: function(f) {
      if (f.indexOf('.git') !== -1 || f.indexOf('.#') !== -1) {
        return false;
      } else {
        return true;
      }
    },
    watchDir: function(dir) {
      var watcher,
        _this = this;
      watcher = hound.watch(dir);
      watcher.on("create", function(f, stat) {
        if (!_this.checkIgnores(f)) {
          return;
        }
        if (stat.isFile()) {
          env.log('created file ' + f, {
            file: f
          }, 'info', 'fs', 'file', 'create');
          return _this.fileChanged(f);
        } else {
          return env.log('created dir ' + f, {
            file: f
          }, 'info', 'fs', 'dir', 'create');
        }
      });
      watcher.on("change", function(f, stat) {
        if (!_this.checkIgnores(f)) {
          return;
        }
        env.log('file changed ' + f, {
          file: f
        }, 'info', 'fs', 'file', 'change');
        return setTimeout(_this.fileChanged(f), 500);
      });
      return watcher.on("delete", function(f, stat) {
        if (!_this.checkIgnores(f)) {
          return;
        }
        env.log('deleted file ' + f, {
          file: f
        }, 'info', 'fs', 'file', 'delete');
        return _this.delPost({
          file: f
        });
      });
    },
    delPost: function(search, callback) {
      return env.blog.findModels(search, {}, function(post) {
        if (post) {
          return post.remove();
        } else {
          return helpers.cbc(callback);
        }
      });
    },
    getPost: function(search, callback) {
      var found;
      found = false;
      return env.blog.findModels(search, {}, function(post) {
        if (post) {
          if (!found) {
            found = true;
            return callback(void 0, post);
          } else {

          }
        } else {
          if (!found) {
            return callback("not found");
          }
        }
      });
    },
    getPosts: function(search, callback) {
      return env.blog.findModels(search, {
        sort: {
          created: -1
        }
      }, callback);
    },
    getPostsByTags: function(search, tags_yes, tags_no, callback) {
      var query;
      if (search == null) {
        search = {};
      }
      if (tags_yes == null) {
        tags_yes = [];
      }
      if (tags_no == null) {
        tags_no = [];
      }
      query = {};
      if (tags_yes.constructor !== Array) {
        tags_yes = _.keys(tags_yes);
      }
      if (tags_no.constructor !== Array) {
        tags_no = _.keys(tags_no);
      }
      console.log("rendering tags: ", tags_yes, tags_no);
      _.map(tags_yes, function(tag) {
        var ret;
        ret = {};
        ret['tags.' + tag] = true;
        return query = ret;
      });
      _.map(tags_no, function(tag) {
        var ret;
        ret = {};
        ret['tags.' + tag] = {
          "$exists": false
        };
        if (query) {
          return query = {
            "$and": [query, ret]
          };
        } else {
          return query = ret;
        }
      });
      return env.blog.findModels(_.extend(search, query), {
        sort: {
          created: -1
        }
      }, callback);
    },
    pingFile: function(file, callback) {
      var _this = this;
      return this.getPost({
        file: file
      }, function(err, post) {
        var stat;
        if (err) {
          _this.fileChanged(file, callback);
          return;
        }
        try {
          stat = fs.statSync(file);
          if (post.get('modified') !== stat.mtime.getTime()) {
            return _this.fileChanged(file, callback);
          } else {
            return helpers.cbc(callback);
          }
        } catch (error) {
          console.log("can't read stat");
          return callback("can't read file stat");
        }
      });
    },
    fileChanged: function(file, callback) {
      var data;
      data = this.parseFile(file);
      if (!data) {
        helpers.cbc(callback, true);
        console.log("NO DATA");
        return;
      }
      env.log('updating entry ' + file, {
        file: file
      }, 'info', 'wiki', 'file', 'change');
      return this.getPost({
        file: data.file
      }, function(err, post) {
        if (post) {
          delete data['created'];
          post.set(data);
        } else {
          post = new env.blog.models.post(data);
        }
        return post.flush(helpers.cbc(callback));
      });
    },
    parseFile: function(file) {
      var data, manualOptions, match, options, pathtags, stat, tags;
      try {
        stat = fs.statSync(file);
        data = fs.readFileSync(file, 'ascii');
      } catch (error) {
        return void 0;
      }
      match = data.match(/^(.*)\n/);
      if (match) {
        match = match[1];
      } else {
        return {
          data: data,
          extraopts: {}
        };
      }
      try {
        manualOptions = eval("x=" + match);
        data = data.replace(/^.*\n/, '');
      } catch (error) {
        manualOptions = {};
      }
      options = {
        created: stat.ctime.getTime(),
        modified: stat.mtime.getTime(),
        file: file,
        link: file,
        title: path.basename(file, path.extname(file)).replace(/_/g, ' '),
        body: data,
        tags: []
      };
      options = _.extend(options, manualOptions);
      pathtags = file.split('/');
      pathtags.pop();
      pathtags.shift();
      tags = {};
      _.map(pathtags.concat(options.tags), function(tag) {
        return tags[tag] = true;
      });
      options.tags = tags;
      return options;
    }
  });

  initRoutes = function(callback) {
    var parseTagsString, serveRss, serveposts, servetags;
    env.app.get('/', function(req, res) {
      return res.render('index', {
        title: 'lesh.sysphere.org'
      });
    });
    parseTagsString = function(tags) {
      var tags_no, tags_yes;
      if (!tags) {
        return [{}, {}];
      }
      tags = "+" + tags;
      tags = tags.replace('+', ' +');
      tags = tags.replace('-', ' -');
      tags_yes = helpers.mapToDict(tags.match(/(?:\+)(\w*)\w/g), function(tag) {
        return tag.replace('+', '');
      });
      tags_no = helpers.mapToDict(tags.match(/\-(\w*)\w/g), function(tag) {
        return tag.replace('-', '');
      });
      return [tags_yes, tags_no];
    };
    serveposts = function(posts, res) {
      return res.render('blog', {
        title: 'blog',
        posts: posts,
        helpers: helpers
      });
    };
    serveRss = function(posts, res, metadata) {
      var channel, preparePost, root;
      if (metadata == null) {
        metadata = {};
      }
      preparePost = function(post) {
        return {
          item: [
            {
              title: post.title
            }, {
              link: 'http://lesh.sysphere.org/article/' + post.link
            }, {
              description: post.body
            }, {
              author: 'lesh@sysphere.org (lesh)'
            }, {
              category: post.tags.join(' ')
            }, {
              guid: 'http://lesh.sysphere.org/article/' + post.link
            }, {
              pubDate: rfc822.formatDate(new Date(post.created))
            }
          ]
        };
      };
      channel = [
        {
          title: metadata.title || 'lesh blog'
        }, {
          link: 'http://lesh.sysphere.org/blog'
        }, {
          language: 'en-us'
        }, {
          description: metadata.description || 'lesh blog'
        }
      ];
      root = {
        rss: [
          {
            _attr: {
              version: "2.0"
            }
          }, {
            channel: channel
          }
        ]
      };
      _.map(posts, function(post) {
        return channel.push(preparePost(post));
      });
      res.header('Content-Type', 'application/xhtml+xml');
      return res.end(xml(root));
    };
    servetags = function(tags_yes, tags_no, key, outputType, res) {
      var posts, tagdata, userdata;
      if (tags_yes == null) {
        tags_yes = {};
      }
      if (tags_no == null) {
        tags_no = {};
      }
      if (key == null) {
        key = "public";
      }
      posts = [];
      tagdata = {};
      if (tags_yes.constructor !== Object) {
        tags_yes = helpers.arrayToDict(tags_yes);
      }
      if (tags_no.constructor !== Object) {
        tags_no = helpers.arrayToDict(tags_no);
      }
      _.extend(tags_no, (userdata = settings.users[key]) ? _.omit(settings.privatetags, _.keys(userdata.tags)) : settings.privatetags);
      console.log("key:", key);
      return env.wiki.getPostsByTags({}, tags_yes, tags_no, function(post) {
        var posttags;
        if (post) {
          posts.push(post.output(tags_yes));
          if (outputType === 'tagcloud') {
            posttags = post.get('tags');
            _.map(tags_yes, function(tag) {
              return delete posttags[tag];
            });
          }
          return helpers.countExtend(tagdata, posttags);
        } else {
          if (outputType === 'tagcloud') {
            tagdata = helpers.scaleDict(tagdata);
          }
          return serveposts(posts, outputType, res, {
            tags: tagdata,
            key: key
          });
        }
      });
    };
    serveposts = function(posts, outputType, res, extraopts) {
      if (extraopts == null) {
        extraopts = {};
      }
      if (outputType === 'rss') {
        return serveRss(posts, res);
      }
      if (outputType === 'txt') {
        return serveTxt(posts, res);
      }
      if (!outputType) {
        outputType = 'blog';
      }
      console.log("rendering " + outputType);
      return res.render(outputType, _.extend({
        posts: posts,
        helpers: helpers,
        _: _,
        title: 'lesh.sysphere.org ' + outputType,
        selected: outputType,
        currenturl: "",
        selected: outputType,
        tags: {},
        key: 'public'
      }, extraopts));
    };
    env.app.get('/:key?/blog/:type?', function(req, res) {
      var outputType;
      if (req.params.type === 'rss.xml') {
        outputType = 'rss';
      } else {
        outputType = 'blog';
      }
      return servetags(['blog'], [], req.params.key, outputType, res);
    });
    env.app.get('/:key?/projects', function(req, res) {
      var outputType;
      if (req.params.type === 'rss') {
        outputType = 'rss';
      } else {
        outputType = 'projects';
      }
      return servetags(['project', 'intro'], [], req.params.key, outputType, res);
    });
    env.app.get('/:key?/tagcloud/:tags?/:type?', function(req, res) {
      var outputType, tags_no, tags_yes, _ref;
      if (req.params.type === 'rss.xml') {
        outputType = 'rss';
      } else {
        outputType = 'tagcloud';
      }
      _ref = parseTagsString(req.params.tags), tags_yes = _ref[0], tags_no = _ref[1];
      return servetags(tags_yes, tags_no, req.params.key, outputType, res);
    });
    return env.app.get(':key?/article/*', function(req, res) {
      var posts, serve;
      serve = function(posts) {
        return res.render('blog', {
          title: 'blog',
          posts: posts,
          helpers: helpers
        });
      };
      posts = [];
      console.log('looking for', {
        file: req.params[0]
      });
      return env.wiki.getPosts({
        file: req.params[0]
      }, function(post) {
        if (post) {
          return posts.push(post.output());
        } else {
          if (posts.length) {
            return serveposts(posts, 'blog', res, {
              selected: '',
              title: posts[0].title
            });
          } else {
            return res.end('post not found');
          }
        }
      });
    });
  };

  initRss = function(callback) {
    return callback();
  };

  initWiki = function(callback) {
    env.wiki = new Wiki({
      dir: settings.postsfolder
    });
    return callback();
  };

  init = function(callback) {
    return async.auto({
      logger: function(callback) {
        return initLogger(env, callback);
      },
      database: ['logger', wraplog('database', initDb)],
      collections: ['database', wraplog('collections', initCollections)],
      wiki: ['collections', wraplog('wiki', initWiki)],
      express: ['database', 'logger', wraplog('express', initExpress)],
      routes: ['express', 'wiki', 'rss', wraplog('routes', initRoutes)],
      rss: ['collections', 'wiki', wraplog('rss', initRss)]
    }, callback);
  };

  init(function(err, data) {
    if (!err) {
      return env.log('system initialized', {}, 'info', 'init', 'done');
    } else {
      return env.log('system init failed', {}, 'info', 'init', 'error');
    }
  });

}).call(this);
