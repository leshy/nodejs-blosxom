(function() {
  var Backbone, Wiki, async, comm, converter, crypto, decorate, decorators, ejslocals, env, express, fs, helpers, hound, http, init, initCollections, initDb, initExpress, initLogger, initRoutes, logger, makeLogDecorator, mongodb, pagedown, path, settings, wiki, wraplog, _;
  var __slice = Array.prototype.slice, __bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; };
  path = require('path');
  fs = require('fs');
  crypto = require('crypto');
  async = require('async');
  _ = require('underscore');
  Backbone = require('backbone4000');
  mongodb = require('mongodb');
  http = require('http');
  express = require('express');
  ejslocals = require('ejs-locals');
  logger = require('logger');
  comm = require('comm/serverside');
  helpers = require('helpers');
  decorators = require('decorators');
  decorate = decorators.decorate;
  hound = require('hound');
  pagedown = require('pagedown');
  converter = new pagedown.Converter();
  env = {};
  settings = {
    postsfolder: "posts"
  };
  ejslocals.ejs.filters.prettyDate = function(obj) {
    return helpers.prettyDate2(obj);
  };
  initLogger = function(callback) {
    env.logger = new logger.logger();
    env.consoleLogger = new logger.consoleLogger();
    env.logger.pass();
    env.logger.connect(env.consoleLogger);
    env.log = env.logger.log.bind(env.logger);
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
    env.blog = new comm.MongoCollectionNode({
      db: env.db,
      collection: 'blog'
    });
    env.post = env.blog.defineModel('post', {
      output: function() {
        return {
          id: this.attributes.id,
          created: this.attributes.created,
          modified: this.attributes.modified,
          tags: _.keys(this.attributes.tags),
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
    app.configure(function() {
      app.engine('ejs', ejslocals.render);
      app.set('view engine', 'ejs');
      app.set('views', __dirname + '/views');
      app.use(express.favicon());
      app.use(express.logger('dev'));
      app.use(express.bodyParser());
      app.use(express.methodOverride());
      app.use(app.router);
      app.use(express.static(__dirname + '/static'));
      return app.use(function(err, req, res, next) {
        env.log('web request error', {
          stack: err.stack
        }, 'error', 'http');
        return res.send(500, 'BOOOM!');
      });
    });
    env.server = http.createServer(env.app);
    env.server.listen(3333);
    env.log('http server listening', {}, 'info', 'init', 'http');
    return callback(void 0, true);
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
      return this.when('dir', __bind(function(dir) {
        this.watchDir(dir);
        return this.crawlDir(dir, __bind(function(file) {
          return this.pingFile(file);
        }, this));
      }, this));
    },
    crawlDir: function(dir, callback) {
      return fs.readdir(dir, __bind(function(err, files) {
        if (err) {
          return;
        }
        return _.map(files, __bind(function(file) {
          var stat;
          file = path.normalize(dir + "/" + file);
          stat = fs.statSync(file);
          if (stat.isDirectory()) {
            this.crawlDir(file, callback);
          }
          if (stat.isFile()) {
            return helpers.cbc(callback, file);
          }
        }, this));
      }, this));
    },
    watchDir: function(dir) {
      var watcher;
      watcher = hound.watch(dir);
      watcher.on("create", __bind(function(f, stat) {
        if (stat.isFile()) {
          env.log('created file ' + f, {
            file: f
          }, 'info', 'fs', 'file', 'create');
          return this.fileChanged(f);
        } else {
          return env.log('created dir ' + f, {
            file: f
          }, 'info', 'fs', 'dir', 'create');
        }
      }, this));
      watcher.on("change", __bind(function(f, stat) {
        env.log('file changed ' + f, {
          file: f
        }, 'info', 'fs', 'file', 'change');
        return this.fileChanged(f);
      }, this));
      return watcher.on("delete", __bind(function(f, stat) {
        env.log('deleted file ' + f, {
          file: f
        }, 'info', 'fs', 'file', 'delete');
        return this.delPost({
          file: file
        });
      }, this));
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
    pingFile: function(file, callback) {
      return this.getPost({
        file: file
      }, __bind(function(err, post) {
        var stat;
        if (err) {
          this.fileChanged(file, callback);
          return;
        }
        try {
          stat = fs.statSync(file);
          if (post.get('modified') === !stat.mtime.getTime()) {
            return this.fileChanged(file, callback);
          } else {
            return helpers.cbc(callback);
          }
        } catch (error) {
          return callback("can't read file stat");
        }
      }, this));
    },
    fileChanged: function(file, callback) {
      var data;
      data = this.parseFile(file);
      if (!data) {
        callback(true);
      }
      return this.getPost({
        file: data.file
      }, function(err, post) {
        if (post) {
          post.set(data);
        } else {
          post = new env.blog.models.post(data);
        }
        return post.flush(function() {
          return helpers.cbc(callback);
        });
      });
    },
    parseFile: function(file) {
      var data, manualOptions, match, options, pathtags, stat, tags;
      try {
        stat = fs.statSync(file);
        data = fs.readFileSync(file, 'ascii');
      } catch (error) {
        return;
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
      tags = {};
      _.map(pathtags.concat(options.tags), function(tag) {
        return tags[tag] = true;
      });
      options.tags = tags;
      return options;
    }
  });
  initRoutes = function(callback) {
    var serveposts;
    env.app.get('/', function(req, res) {
      return res.render('index', {
        title: 'lesh.sysphere.org'
      });
    });
    serveposts = function(posts, res) {
      return res.render('blog', {
        title: 'blog',
        posts: posts,
        helpers: helpers
      });
    };
    env.app.get('/blog', function(req, res) {
      var posts;
      posts = [];
      return env.wiki.getPosts({}, function(post) {
        if (post) {
          return posts.push(post.output());
        } else {
          return serveposts(posts, res);
        }
      });
    });
    env.app.get('/blog/get/*', function(req, res) {
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
            return serveposts(posts, res);
          } else {
            return res.end('404');
          }
        }
      });
    });
    env.app.get('/posts', function(req, res) {
      return env.wiki.getPosts({}, function(post) {
        if (post) {
          console.log('sending', post.attributes);
          return res.write(JSON.stringify(post.output()) + "\n");
        } else {
          return res.end();
        }
      });
    });
    return callback();
  };
  wiki = function(callback) {
    env.wiki = new Wiki({
      dir: settings.postsfolder
    });
    return callback();
  };
  init = function(callback) {
    return async.auto({
      logger: initLogger,
      database: ['logger', wraplog('database', initDb)],
      collections: ['database', wraplog('collections', initCollections)],
      express: ['database', 'logger', wraplog('express', initExpress)],
      routes: ['express', 'wiki', wraplog('routes', initRoutes)],
      wiki: ['collections', wraplog('wiki', wiki)]
    }, callback);
  };
  init(function() {
    return env.log('system initialized', {}, 'info', 'init', 'done');
  });
}).call(this);
