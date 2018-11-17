const builder = require('mioritaserver');
const config = {

commondir: 'common_module',

source: ["common_module/lib","common_module/components"],

module: {
	react: ["react","react-dom","create-react-class","prop-types","object-assign"],
	depmod: ["randombytes","sha.js","Chartist","react-notification-system"]
},

bundle: {
	react: ["react"],
	depmod: ["depmod","lib"],
	common: ["components"],
},

localmap: [
	{url: "/-css/", path: "/static/css/"},
	{url: "/-js/", path: "/static/js/"},
	{url: "/-img/", path: "/static/img/"}
],
forwardmap: [
	{url: "/CreateSession", path: "/CreateSession", host: "localhost", port: 1040},
	{url: "/ValidateSession", path: "/ValidateSession", host: "localhost", port: 1040},
	{url: "/api/", path: "/api/", host: "localhost", port: 1040},
	{url: "/--css/", path: "/css/", host: "localhost", port: 1040},
	{url: "/--js/", path: "/js/", host: "localhost", port: 1040},
	{url: "/--img/", path: "/img/", host: "localhost", port: 1040}
],

};
builder.run(config);
