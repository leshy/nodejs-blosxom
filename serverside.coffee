path = require 'path'
fs = require 'fs'
crypto = require 'crypto'
async = require 'async'
_ = require 'underscore'
Backbone = require 'backbone4000'

mongodb = require 'mongodb'
http = require 'http'
express = require 'express'
ejslocals = require 'ejs-locals'

logger = require 'logger'
comm = require 'comm/serverside'
helpers = require 'helpers'

decorators = require 'decorators'
decorate = decorators.decorate

hound = require 'hound'

pagedown = require 'pagedown'
converter = new pagedown.Converter()

env = {}

settings = postsfolder: "posts"

ejslocals.ejs.filters.prettyDate = (obj) -> 
    helpers.prettyDate2(obj)

initLogger = (callback) ->
    env.logger = new logger.logger()
    env.consoleLogger = new logger.consoleLogger()
    env.logger.pass()
    env.logger.connect(env.consoleLogger)
    env.log = env.logger.log.bind(env.logger)
    env.log('logger initialized', {}, 'init','info')
    callback()

initDb = (callback) ->
    env.db = new mongodb.Db 'blog', new mongodb.Server('localhost', 27017), safe: true
    env.db.open callback

initCollections = (callback) ->
    env.blog = new comm.MongoCollectionNode db: env.db, collection: 'blog'
    env.post = env.blog.defineModel 'post',
        output: ->
            id: @attributes.id
            created: @attributes.created
            modified: @attributes.modified
            tags: _.keys @attributes.tags
            title: @attributes.title
            link: @attributes.file
            body: converter.makeHtml(@attributes.body)
    callback()

initExpress = (callback) ->
    env.app = app = express()
            
    app.configure ->
        app.engine 'ejs', ejslocals.render
        app.set 'view engine', 'ejs'
        app.set 'views', __dirname + '/views'
        app.use express.favicon()
        app.use express.logger('dev')
        app.use express.bodyParser()
        app.use express.methodOverride()
        app.use app.router
        app.use express.static(__dirname + '/static')
        app.use (err, req, res, next) ->
            env.log 'web request error', { stack: err.stack }, 'error', 'http'
            res.send 500, 'BOOOM!'

    env.server = http.createServer env.app
    env.server.listen 3333
    env.log 'http server listening', {}, 'info', 'init', 'http'
    callback undefined, true


makeLogDecorator = (name) -> 
    (f,callback,args...) ->
        f (err,data) ->
            if not err
                env.log(name + ' ready', {}, 'info', 'init', 'done', name)
            else
                env.log(name + ' failed!', {}, 'info', 'init', 'error', name)
            callback(err,data)

wraplog = (name,f) -> decorators.decorate makeLogDecorator(name), f


Wiki = Backbone.Model.extend4000
    initialize: ->
        @when 'dir', (dir) =>
            @watchDir dir
            @crawlDir dir, (file) => @pingFile(file)
        
        
    crawlDir: (dir,callback) ->
        fs.readdir dir, (err,files) =>
            if err then return
            _.map files, (file) =>
                file = path.normalize(dir + "/" + file)
                stat = fs.statSync(file)
                if stat.isDirectory() then @crawlDir file, callback
                if stat.isFile() then helpers.cbc callback, file
            

    watchDir: (dir) -> 
        watcher = hound.watch(dir)

        watcher.on "create", (f,stat) =>
            if stat.isFile()
                env.log('created file ' + f, { file: f }, 'info', 'fs', 'file', 'create')
                @fileChanged(f)
            else
                env.log('created dir ' + f, { file: f }, 'info', 'fs', 'dir', 'create')
                
        watcher.on "change", (f,stat) =>
            env.log('file changed ' + f, { file: f }, 'info', 'fs', 'file', 'change')
            @fileChanged(f)
            
        watcher.on "delete", (f,stat) =>
            env.log('deleted file ' + f, { file: f }, 'info', 'fs', 'file', 'delete')
            @delPost { file: file }
        
    delPost: (search, callback) ->
        env.blog.findModels search, {}, (post) ->
            if post then post.remove() else helpers.cbc(callback)

    getPost: (search, callback) ->
        found = false
        env.blog.findModels search, {}, (post) ->
            if post
                if not found then found = true; callback undefined, post else return;
            else
                if not found then callback "not found"


    getPosts: (search,callback) -> env.blog.findModels search, {sort: {created: -1}}, callback


    pingFile: (file,callback) ->
        @getPost {file: file}, (err,post) =>
            if err then @fileChanged(file,callback); return
            try
                stat = fs.statSync(file)
                if post.get('modified') is not stat.mtime.getTime() then @fileChanged(file,callback) else helpers.cbc callback
            catch error
                callback "can't read file stat"


    fileChanged: (file,callback) ->
        data = @parseFile(file)
        if not data then callback true

        @getPost { file: data.file }, (err,post) ->
            if post then post.set(data) else post = new env.blog.models.post data
            post.flush -> helpers.cbc(callback)
    
    parseFile: (file) ->
        # read file contents and stat
        try
            stat = fs.statSync(file)
            data = fs.readFileSync file, 'ascii'
        catch error
            return undefined


        # find the first line of a file and execute it
        match = data.match(/^(.*)\n/)
        if match then match = match[1] else return { data: data, extraopts: {} }
        try
            manualOptions = eval("x=" + match)
            data = data.replace(/^.*\n/,'')
        catch error
            manualOptions = {}        

        # generate basic options
        options =
            created: stat.ctime.getTime()
            modified: stat.mtime.getTime()
            file: file
            link: file
            title: path.basename(file,path.extname(file)).replace(/_/g,' ')
            body: data
            tags: []

        options = _.extend options,manualOptions
        
        # apply path as tags
        pathtags = file.split('/')
        pathtags.pop()

        tags = {}
        
        _.map pathtags.concat(options.tags), (tag) ->
            tags[tag] = true
            
        options.tags = tags
        
        return options



initRoutes = (callback) ->
    env.app.get '/', (req,res) ->
      res.render 'index', { title: 'lesh.sysphere.org' }

    serveposts = (posts,res) -> res.render 'blog', { title: 'blog', posts: posts, helpers: helpers } 

    env.app.get '/blog', (req,res) ->
        posts = []
        env.wiki.getPosts {}, (post) ->
            if post then posts.push post.output() else serveposts posts, res

    env.app.get '/blog/get/*', (req,res) ->
        serve = (posts) -> res.render 'blog', { title: 'blog', posts: posts, helpers: helpers }    
        posts = []
        console.log('looking for', { file: req.params[0] })
        
        env.wiki.getPosts { file: req.params[0] }, (post) ->
            if post then posts.push post.output() else
                if posts.length then serveposts posts, res else res.end('404')
                    
    env.app.get '/posts', (req,res) ->
        env.wiki.getPosts {}, (post) ->
            if post
                console.log('sending',post.attributes)
                res.write JSON.stringify(post.output()) + "\n"
            else
                res.end()
    callback()



wiki = (callback) ->
    env.wiki = new Wiki {dir: settings.postsfolder}
    callback()



init = (callback) ->
    async.auto        
        logger: initLogger
        database: [ 'logger', wraplog('database', initDb) ]
        collections: [ 'database', wraplog('collections', initCollections) ]
        express: [ 'database', 'logger', wraplog('express',initExpress) ]
        routes: [ 'express', 'wiki', wraplog('routes',initRoutes) ]
        wiki: [ 'collections', wraplog('wiki', wiki) ]
        callback

init ->
    env.log 'system initialized',{}, 'info','init','done'
