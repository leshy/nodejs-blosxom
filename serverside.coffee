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

collections = require 'collections/serverside'
helpers = require 'helpers'

decorators = require 'decorators'
decorate = decorators.decorate

hound = require 'hound'
rss = require 'rss'

pagedown = require 'pagedown'
converter = new pagedown.Converter()

env = {}

settings = postsfolder: "posts"

ejslocals.ejs.filters.prettyDate = (obj) -> 
    helpers.prettyDate(obj)

initLogger = (env,callback) ->    
    env.log = (text,data,taglist...) ->
        tags = {}
        _.map taglist, (tag) -> tags[tag] = true
        if tags.error then text = text.red
        if tags.error and _.keys(data).length then json = " " + JSON.stringify(tags.error) else json = ""
        console.log String(new Date()).yellow + " " + _.keys(tags).join(', ').green + " " + text + json

    env.logres = (name, callback) ->
        (err,data) -> 
            if (err)
                env.log name + ': ' + err, {error: err}, 'init', 'fail'
            else
                env.log name + "...", {}, 'init', 'ok'
            callback(err,data)
        
    env.log('logger initialized', {}, 'init','info')

    callback()


initDb = (callback) ->
    env.db = new mongodb.Db 'blog', new mongodb.Server('localhost', 27017), safe: true
    env.db.open callback

initCollections = (callback) ->
    env.blog = new collections.MongoCollection db: env.db, collection: 'blog'
    env.post = env.blog.defineModel 'post',
        output: (ignoretags) ->
            id: @attributes.id
            created: @attributes.created
            modified: @attributes.modified
            tags: _.without.apply(this, [ _.keys(@attributes.tags) ].concat(ignoretags)) # blah
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
            setTimeout @fileChanged(f), 500
            
        watcher.on "delete", (f,stat) =>
            env.log('deleted file ' + f, { file: f }, 'info', 'fs', 'file', 'delete')
            @delPost { file: f }
        
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

    getPostsByTags: (search = {}, tags_yes=[], tags_no=[], callback) ->
        query = {}
        
        _.map tags_yes, (tag) ->
            ret = {}; ret['tags.' + tag] = true
            query = ret

        _.map tags_no, (tag) ->
            ret = {}; ret['tags.' + tag] = { "$exists" : false }
            if query then query = { "$and" : [query, ret] } else query = ret
        
        env.blog.findModels _.extend( search, query ), {sort: {created: -1}}, callback

    getTags: (search = {}, tags_yes=[],tags_no=[],callback) ->
        tagdata = {}
        @getPostsByTags {}, tags_yes, tags_no, (post) ->
            if not post then callback helpers.scaleDict tagdata; return
            posttags = post.get('tags')
            _.map tags_yes, (tag) -> delete posttags[tag]
            helpers.countExtend tagdata, posttags
        
    pingFile: (file,callback) ->
        @getPost {file: file}, (err,post) =>
            if err then @fileChanged(file,callback); return
            try
                stat = fs.statSync(file)
                if post.get('modified') != stat.mtime.getTime() then @fileChanged(file,callback) else helpers.cbc callback
            catch error
                console.log("can't read stat")
                callback "can't read file stat"

    fileChanged: (file,callback) ->
        data = @parseFile(file)
        if not data then helpers.cbc callback, true; console.log "NO DATA"; return
        env.log('updating entry ' + file, { file: file }, 'info', 'wiki', 'file', 'change')
        @getPost { file: data.file }, (err,post) ->
            if post then post.set(data) else post = new env.blog.models.post _.extend({created: new Date().getTime()}, data)
            post.flush helpers.cbc callback
    
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
            modified: stat.mtime.getTime()
            file: file
            link: file
            title: path.basename(file,path.extname(file)).replace(/_/g,' ')
            body: data
            tags: []

        options = _.extend options, manualOptions

        # write options JSON back to the file
        # sooo boring... I'll do this later

        # apply path as tags
        pathtags = file.split('/')
        pathtags.pop()
        pathtags.shift()

        tags = {}
        
        _.map pathtags.concat(options.tags), (tag) ->
            tags[tag] = true
            
        options.tags = tags
        
        return options



initRoutes = (callback) ->
    env.app.get '/', (req,res) ->
      res.render 'index', { title: 'lesh.sysphere.org' }


    parseTagsString = (tags) ->
        if not tags then return [ [], [] ]
        tags = "+" + tags
        tags = tags.replace('+', ' +')
        tags = tags.replace('-', ' -')
        tags_yes = _.map tags.match(/(?:\+)(\w*)\w/g), (tag) -> tag.replace '+', ''
        tags_no = _.map tags.match(/\-(\w*)\w/g), (tag) -> tag.replace '-', ''

        return [ tags_yes, tags_no ]

    serveposts = (posts,res) -> res.render 'blog', { title: 'blog', posts: posts, helpers: helpers } 

    env.app.get '/blog', (req,res) ->
        posts = []
        env.wiki.getPosts { "tags.blog": true }, (post) ->
            if post then posts.push post.output(['blog']) else serveposts posts, res

    env.app.get '/projects', (req,res) ->
        posts = []
        env.wiki.getPosts { "tags.project": true, "tags.mainpage": true }, (post) ->
            if post
                posts.push post.output(["project","mainpage"])
            else
                res.render 'projects', { title: 'projects', posts: posts, helpers: helpers } 

    env.app.get '/article/*', (req,res) ->
        serve = (posts) -> res.render 'blog', { title: 'blog', posts: posts, helpers: helpers }    
        posts = []
        console.log('looking for', { file: req.params[0] })
        
        env.wiki.getPosts { file: req.params[0] }, (post) ->
            if post then posts.push post.output() else
                if posts.length then serveposts posts, res else res.end('404')
                    
    env.app.get '/tag/:tags?*', (req,res) ->
        posts = []
        
        [ tags_yes, tags_no ] = parseTagsString req.params.tags 

        # here we add forbidden tags for this user / filter depending on permission                        
        env.wiki.getPostsByTags {}, tags_yes, tags_no, (post) -> 
            if post then posts.push post.output(tags_yes) else serveposts posts, res
        
    env.app.get '/posts', (req,res) ->
        env.wiki.getPosts {}, (post) ->
            if post
                console.log('sending',post.attributes)
                res.write JSON.stringify(post.output()) + "\n"
            else
                res.end()
    callback()
    env.app.get '/tagcloud/:tags?*', (req,res) ->
        posts = []
        tagdata = {}

        [ tags_yes, tags_no ] = parseTagsString req.params.tags
 
        # here we add forbidden tags for this user / filter depending on permission                        
        env.wiki.getPostsByTags {}, tags_yes, tags_no, (post) -> 
            if not post
                tagdata = helpers.scaleDict(tagdata)
                console.log "tagdata", tagdata
                res.render 'tagcloud', { title: 'tagcloud', posts: posts, helpers: helpers, tags: tagdata, currenturl: req.params.tags or "" }
                return
                
            posts.push post.output(tags_yes)

            posttags = post.get('tags')
            _.map tags_yes, (tag) -> delete posttags[tag]
            helpers.countExtend tagdata, posttags
            
        
    env.app.get '/posts', (req,res) ->
        env.wiki.getPosts {}, (post) ->
            if post
                console.log('sending',post.attributes)
                res.write JSON.stringify(post.output()) + "\n"
            else
                res.end()
    callback()


initRss = (callback) ->
    env.rssfeed = new rss
            title: 'lesh blog',
            description: '2blog',
            feed_url: 'http://lesh.sysphere.org/blog/rss.xml',
            site_url: 'http://lesh.sysphere.org',
            author: 'lesh'

    callback()
    
initWiki = (callback) ->
    env.wiki = new Wiki {dir: settings.postsfolder}
    callback()


init = (callback) ->
    async.auto        
        logger: (callback) -> initLogger(env,callback)
        database: [ 'logger', wraplog('database', initDb) ]
        collections: [ 'database', wraplog('collections', initCollections) ]
        wiki: [ 'collections', wraplog('wiki', initWiki) ]
        express: [ 'database', 'logger', wraplog('express',initExpress) ]
        routes: [ 'express', 'wiki', 'rss', wraplog('routes',initRoutes) ]
        rss: [ 'collections', 'wiki', wraplog('rss', initRss) ]
        callback

init (err,data) ->
    if not err
        env.log 'system initialized',{}, 'info','init','done'
    else
        env.log 'system init failed',{}, 'info','init','error'


