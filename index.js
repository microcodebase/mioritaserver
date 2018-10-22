'use strict';
function formatLocal(utc) {
	let dt = new Date(utc.getTime());
	dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
	let iso = dt.toISOString();
	return iso.slice(0, 10) + ' ' + iso.slice(11, 19);
}
process.env.NODE_ENV = 'development'; // development production
let jsDebug = true;
let jsComments = false;
let jsCompact = true;
let lessCompress = true;
const
	path = require('path'),
	fs = require('fs-extra'),
	http = require('http'),
	browserify = require('browserify'),
	babelify = require('babelify'),
	less = require('less'),
	exorcist = require('exorcist'),
	through = require('through'),
	concat = require('concat-stream');

let workspace;
let commondir;
let export_App;
let buildconfig;
let projectname;	// project folder name = bundle name
let external = {};
let exported = {};

function Initialize() {
	fs.mkdir(workspace + '/static', err => {
		if (err && err.code != 'EEXIST') {
		}
	});
	fs.mkdir(workspace + '/static/js', err => {
		if (err && err.code != 'EEXIST') {
		}
	});
	fs.mkdir(workspace + '/static/css', err => {
		if (err && err.code != 'EEXIST') {
		}
	});
}

function LoadProject(projdir) {
	buildconfig = null;
	export_App = null;
	projectname = projdir;
	const workdir = workspace + '/' + projectname;
	try {
		const jsonstr = fs.readFileSync(workdir + '/buildconfig.json', 'utf8');
		buildconfig = JSON.parse(jsonstr);
	} catch (err) {
		console.error(err.message);
		//console.error(err);
		return;
	}
	let external_App = ['../' + projectname + '/main']; // Entry point
	if (buildconfig.app) external_App = buildconfig.app;
	export_App = [];
	for(let i = 0; i<external_App.length; ++i) {
		export_App.push({file: external_App[i] + '.jsx', expose: external_App[i]});
		//export_App.push(external_App[i]);
	}
	console.log('Project: \x1b[97m\x1b[42m', projectname, '\x1b[0m');
}

function clean(cb) {
	const dir1 = workspace + '/static/js';
	const dir2 = workspace + '/static/css';
	fs.emptyDir(dir1, err => { if (err) console.log(err); });
	fs.emptyDir(dir2, err => { if (err) console.log(err); });
	cb();
}
function fixLess() {
	const fileManagers = less.environment && less.environment.fileManagers || [];
	fileManagers.forEach(fileManager => {
		 if (fileManager.contents) {
				   fileManager.contents = {};
		 }
	});
}
function makeCss(dst, src, basedir, cb) {
	fs.readFile(src, 'utf8', (err, data) => {
		if (err) {
			console.log('\x1b[91mread less file\x1b[0m');
			console.error(err);
			console.log('');
			cb();
		} else {
			fixLess();
			less.render(data, {paths: basedir, compress: lessCompress}, (err, output) => {
				if (err) {
					console.log('\x1b[91mLess compile\x1b[0m');
					console.error(err);
					console.log('');
					cb();
				} else {
					fs.writeFile(dst, output.css, { encoding: 'utf8' }, err => {
						if (err) {
							console.log('\x1b[91mwrite css file\x1b[0m');
							console.error(err);
							console.log('');
							cb();
						} else {
							cb();
						}
					});
				}
			});
		}
	});
}

function build_common_less(cb) {
	const dst = workspace + '/static/css/common.css';
	const src = commondir + '/common_less/common.less';
	const basedir = commondir + '/common_less';
	makeCss(dst, src, basedir, cb);
}
function build_app_less(cb) {
	const dst = workspace + '/static/css/' + projectname + '.css';
	const workdir = workspace + '/' + projectname;
	const src = workdir + '/less/main.less';
	const basedir = workdir + '/less';
	makeCss(dst, src, basedir, cb);
}
//-------------------
let cachedb = {};
function transformator(file, options) {
	//console.log(file);
	//console.log(options);
	//let tf = babelify(file, options);
	//console.log('tf', tf);
	//return tf;
	let data = '';
	return through(write, end);
	function write (buf) { data += buf }
	function end () {
		const stats = fs.statSync(file);
		const mt = stats.mtime.getTime();
		let compiled = cachedb[file];
		if (compiled && (compiled[1] === mt)) {
			this.queue(compiled[0]);
			this.queue(null);
			return;
		}
		cachedb[file] = null;
		console.log('\x1b[92mcompile:\x1b[0m', file);
		let cacher = concat((d) => {
			this.queue(d);
			this.queue(null);
			cachedb[file] = [d, mt];
		});
		let tf = babelify(file, options);
		tf.on('error', (err) => {
			this.emit('error', err);
		});
		tf.pipe(cacher);
		tf.write(data);
		tf.end();
	}
}
//-------------------
let bundleVector;

function onFile(file, id, parent) {
	console.log('\x1b[92m', id, '\x1b[0m');
}

function makeBundle() {
	cachedb = {};
	bundleVector = [];
	let b;
	let basedir = commondir + '/relativenil';

	b = browserify({ basedir: basedir, debug: jsDebug });
	b.require(exported.react);
	b.transform(transformator, { presets: ['@babel/preset-env'], comments: jsComments, compact: jsCompact });
	b.on('file', onFile);
	bundleVector[0] = ['react.js', b];

	b = browserify({ basedir: basedir, debug: jsDebug });
	b.external(external.react);
	b.require(exported.lib);
	b.require(exported.depmod);
	b.transform(transformator, { presets: ['@babel/preset-env'], comments: jsComments, compact: jsCompact });
	b.on('file', onFile);
	bundleVector[1] = ['depmod.js', b];

	b = browserify({ basedir: basedir, debug: jsDebug, extensions: ['.jsx'] });
	b.external(external.react);
	b.external(external.lib);
	b.external(external.depmod);
	b.require(exported.components);
	b.transform(transformator, { presets: ['@babel/preset-env', '@babel/preset-react'], comments: jsComments, compact: jsCompact });
	b.on('file', onFile);
	bundleVector[2] = ['common.js', b];

	b = browserify({  basedir: basedir, debug: jsDebug, entries: '../page/AppStartUp', extensions: ['.jsx'] });
	b.external(external.react);
	b.external(external.lib);
	b.external(external.depmod);
	b.external(external.components);
	b.transform(transformator, { presets: ['@babel/preset-env', '@babel/preset-react'], comments: jsComments, compact: jsCompact });
	b.on('file', onFile);
	bundleVector[3] = ['appstartup.js', b];

	basedir = workspace + '/' + projectname + '/relativenil';
	b = browserify({ basedir: basedir, debug: jsDebug, extensions: ['.jsx'] });
	b.external(external.react);
	b.external(external.lib);
	b.external(external.depmod);
	b.external(external.components);
	b.require(export_App);
	b.transform(transformator, { presets: ['@babel/preset-env', '@babel/preset-react'], comments: jsComments, compact: jsCompact });
	b.on('file', onFile);
	bundleVector[4] = [projectname + '.js', b];
}

function createBundle(k, cb, SourceMap) {
	const aim = bundleVector[k];
	const filename = workspace + '/static/js/' + aim[0];
	const b = aim[1];

	const rs = b.bundle();
	/*rs.on('end', () => {
		console.log('all done');
	});*/
	rs.on('error', (err) => {
		console.log('\x1b[91mon jsx bundle\x1b[0m');
		console.error(err.stack);
		//console.error(err.message);
		//console.error(err.filename);
		//console.error(err);
		console.log();
		cb('error on bundle');

	});
	const ws = fs.createWriteStream(filename);
	ws.on('finish', () => {
		//console.log('finish');
		cb();
	});
	ws.on('error', (err) => {
		console.log('\x1b[91mcreate bundle\x1b[0m');
		console.error(err);
		console.log();
	});
	if (SourceMap) {
		rs.pipe(exorcist(filename + '.map'))
		.on('error', (err) => {
			console.log('\x1b[91mexorcist\x1b[0m');
			console.error(err);
			console.log();
		})
		.on('missing-map', console.error.bind(console))
		.pipe(ws);
	} else {
		rs.pipe(ws);
	}
}

function processCommand(verb, cb) {
	switch(verb) {
		case 'q':
		case '0':
			process.stdout.write('\x1bc\x1b[0m');
			ShowProjects();
			break;
		case '9':
			console.log('clean');
			clean(cb);
			break;
		case '1':
			console.log('build application css');
			build_app_less(cb);
			break;
		case '2':
			console.log('build application js');
			createBundle(4, cb, true);
			break;
		case '80':
			console.log('build common css');
			build_common_less(cb);
			break;
		case '81':
			console.log('build common js');
			createBundle(2, cb, true);
			break;
		case '82':
			console.log('build startup app js');
			createBundle(3, cb, true);
			break;
		case '83':
			console.log('build react js lib');
			createBundle(0, cb, true);
			break;
		case '84':
			console.log('build depmod js lib');
			createBundle(1, cb, true);
			break;
		case '*':
			ShowActions(true);
			break;
		case 'compress':
			lessCompress = true;
			break;
		case 'no compress':
			lessCompress = false;
			break;
		case 'compact':
			jsCompact = true;
			break;
		case 'no compact':
			jsCompact = false;
			break;
	}
}
function ShowActions(s) {
	console.log();
	console.log('0 - go to main menu');
	console.log('9 - clean');
	console.log('1 - build css');
	console.log('2 - build js');
	if (s) {
		console.log('80 - build common css');
		console.log('81 - build common js');
		console.log('82 - build startup app js');
		console.log('83 - build react js lib');
		console.log('84 - build depmod js lib');
		console.log('compress - compress less');
		console.log('no compress - do not compress less');
		console.log('compact - compact js');
		console.log('no compact - do not compact js');
	}
	console.log();
}

const mimeTypes = {
".htm": "text/html",
".html": "text/html",
".jpeg": "image/jpeg",
".jpg": "image/jpeg",
".png": "image/png",
".js": "text/javascript",
".css": "text/css",
".json": "application/json",
".map": "application/json",
".txt": "text/plain"
};
//application/octet-stream
// ANSI escape sequences
//console.log('\x1b[s\x1b[1A\x1b[99C\x1b[91m fullname is: \x1b[0m' + fullname + '\x1b[u');

function ReturnFile (filepath, response) {
	let mime = mimeTypes[path.extname(filepath)];
	if (mime) {
		const fullname = workspace + filepath;
		fs.readFile(fullname, (err, data) => {
			if (err) {
				if(err.code === 'ENOENT') {
					response.writeHead(404, {'Content-Type': 'text/plain'});
					response.end('Not Found');
					console.log('\x1b[91mFile Not Found\x1b[0m', filepath);
				} else {
					response.writeHead(500, {'Content-Type': 'application/json'});
					response.end(JSON.stringify(err));
					console.error(err);
				}
			} else {
				response.writeHead(200, { 'Content-Type': mime });
				response.end(data);
			}
		});
	} else {
		response.writeHead(404, {'Content-Type': 'text/plain'});
		response.end('MIME Not Found');
		console.log('\x1b[91mMIME Not Found\x1b[0m', filepath);
	}
}

function Compile (url, response) {
	if (url == '/static/css/' + projectname + '.css') {
		build_app_less((err) => {
			if (err) {
				response.writeHead(500, {'Content-Type': 'text/plain'});
				response.end('Compile error');
				console.error('Compile error');
			} else {
				ReturnFile(url, response);
			}
		});
		return true;
	} else if (url == '/static/js/' + projectname + '.js') {
		const cb = (err) => {
			if (err) {
				response.writeHead(500, {'Content-Type': 'text/plain'});
				response.end('Compile error');
				console.error('Compile error');
			} else {
				ReturnFile(url, response);
			}
		};
		createBundle(4, cb, true);
		return true;
	}
	return false;
}

function RemoteHandler(options, request, response) {
		options.method = request.method;
		options.headers = {};
		if (request.headers['content-type']) options.headers['Content-Type'] = request.headers['content-type'];
		if (request.headers['content-length']) options.headers['Content-Length'] = request.headers['content-length'];
		if (request.headers['x-auth-token']) options.headers['X-AUTH-TOKEN'] = request.headers['x-auth-token'];
		let client = http.request(options, (resp) => {
			let headers = {};
			if (resp.headers['content-type']) headers['Content-Type'] = resp.headers['content-type'];
			if (resp.headers['content-length']) headers['Content-Length'] = resp.headers['content-length'];
			response.writeHead(resp.statusCode, headers);
			resp.on('data', (chunk) => {
				response.write(chunk);
			});
			resp.on('end', () => {
				response.end();
			});
			if (resp.statusCode !== 200) {
				console.error('\x1b[91mremote response\x1b[0m', resp.statusCode);
			}
		});
		client.on('error', (err) => {
			response.writeHead(500, {'Content-Type': 'text/plain'});
			response.end('remote error');
			console.error('\x1b[91mremote error\x1b[0m');
			console.error(err);
			console.error('');
		});
		request.on('data', (chunk) => {
			client.write(chunk);
		});
		request.on('end', () => {
			client.end();
		});
}

function CheckForward(url) {
	if (buildconfig.forwardmap) {
		for (let i = 0; i < buildconfig.forwardmap.length; ++i) {
			let forward = buildconfig.forwardmap[i];
			if (forward.url === url.substr(0, forward.url.length)) {
				let opt = {hostname: forward.host, port: forward.port || 80, path: forward.path + url.substr(forward.url.length)}
				return opt;
			}
		}
	}
}
function CheckLocal(url) {
	if (buildconfig.localmap) {
		for(let i = 0; i < buildconfig.localmap.length; ++i) {
			let forward = buildconfig.localmap[i];
			if (forward.url === url.substr(0, forward.url.length)) {
				return forward.path + url.substr(forward.url.length);
			}
		}
	}
	if ('/static/' === url.slice(0, 8)) {
		return url;
	}
}

let rn = 0;

function run() {
		let server = http.createServer( (request, response) => {
			++rn;
			request.on('error', (err) => {
				console.error('request error', err);
			});
			response.on('error', (err) => {
				console.error('response error', err);
			});
			let method = request.method, url = request.url;
			console.log(rn+' '+method+' '+url);
			if (!buildconfig) {
				response.writeHead(500, {'Content-Type': 'text/plain'});
				response.end('Please select the project !');
				return;
			}
			if (method === 'GET') {
				let localfile = url;
				let i = localfile.indexOf('?');
				if (i >= 0) {
					localfile = localfile.slice(0, i);
				}
				if(localfile === '/') {
					ReturnFile('/' + projectname + '/index.html', response);
				} else {
					let ok = Compile(localfile, response);
					if (!ok) {
						localfile = CheckLocal(localfile);
						if (localfile) {
							ReturnFile(localfile, response);
						} else {
							let forward = CheckForward(url);
							if (forward) {
								RemoteHandler(forward, request, response);
							} else {
								response.writeHead(404, {'Content-Type': 'text/plain'});
								response.end('Not Found');
								console.log('\x1b[91mNot Found\x1b[0m', url);
							}
						}
					}
				}
			} else if (method === 'POST') {
				let forward = CheckForward(url);
				if (forward) {
					RemoteHandler(forward, request, response);
				} else {
					response.writeHead(404, {'Content-Type': 'text/plain'});
					response.end('Not Found');
					console.log('\x1b[91mNot Found\x1b[0m', url);
				}
			} else {
				response.writeHead(405, {'Content-Type': 'text/plain'});
				response.end('Method Not Allowed');
				console.log('Method Not Allowed', url);
			}
		});
		server.listen(8989, (err) => {
			if(err){
				console.log("server.listen", err);
			} else {
				console.log("Server listening on: http://localhost:8989/");
			}
		});
}

let appstate = 0;
let projects;
function ShowProjects() {
	appstate = 0;
	projects = [];
	// allready absolute
	fs.readdir(workspace, (err, files) => {
		files.forEach(file => {
			let fullname = workspace + '/' + file;
			if (fs.statSync(fullname).isDirectory()){
				if (file !== 'static') {
					projects.push(file);
				}
			}
		});
		console.log();
		console.log('0 - quit');
		for(let i=0; i<projects.length; ++i) {
			console.log(i+1 + ' - ' + projects[i]);
		}
		console.log();
	});
}

function SelectProject(data) {
	if (data === 'q' || data === '0') {
		console.log('bye');
		process.exit(0);
	} else {
		let i = parseInt(data);
		if (i > 0 && i <= projects.length) {
			--i;
			process.stdout.write('\x1bc\x1b[0m');
			appstate = 1;
			LoadProject(projects[i]);
			makeBundle();
			ShowActions();
		}
	}
}

function prepareSource(config) {
	const src = config.source;
	let counter = src.length;
	for (let i=0; i<src.length; ++i) {
		let dir = workspace + '/' + src[i];
		let lib = path.basename(src[i]);
		fs.readdir(dir, (err, files) => {

			let xt = [];
			for (let k=0; k<files.length; ++k) {
				//console.log('---', files[k]);
				let pp = (lib === 'lib') ? '' : '../' + lib + '/';
				xt.push( pp + path.basename(files[k], path.extname(files[k])));
			}
			external[lib] = xt;

			let xp = [];
			for (let k=0; k<files.length; ++k) {
				//console.log('---', files[k]);
				let pp = (lib === 'lib') ? '' : '../' + lib + '/';
				xp.push({
					file: '../' + lib + '/' + files[k],
					expose: pp + path.basename(files[k], path.extname(files[k]))
				});
			}
			exported[lib] = xp;

			counter--;
			if (counter === 0) {
				//console.log('external', external);
				//console.log('exported', exported);
			}
		});
	}
}

function prepareModules(config) {
	const mod = config.module;
	external.react = mod.react;
	exported.react = mod.react;
	external.depmod = mod.depmod;
	exported.depmod = mod.depmod;
}

function startup(config) {
	console.log('started:', formatLocal(new Date()));

	workspace = config.workspace;
	commondir = workspace + '/' + config.commondir;
	prepareModules(config);
	prepareSource(config);

	console.log('workspace:\x1b[92m', workspace, '\x1b[0m');
	try {
		process.chdir(workspace);
	} catch (err) {
		console.error(err.message);
		console.error(workspace);
		return;
	}

	Initialize();
	run();
	ShowProjects();

	process.on('SIGINT', () => {
		console.log('Got a SIGINT. Goodbye world');
		setTimeout(() => {
			process.exit(0);
		}, 1000);
	});

	process.stdin.on('data', (chunk) => {
		let data = chunk.toString().trim();
		switch(appstate) {
			case 0:
				SelectProject(data);
				break;
			case 1:
				let hrstart = process.hrtime();
				processCommand(data, (err) => {
					let hrend = process.hrtime(hrstart);
					console.log('done in %d s %d ms', hrend[0], Math.round(hrend[1]/1000000));
					console.log();
				});
				break;
		}
	});
}

module.exports = { run : startup };

