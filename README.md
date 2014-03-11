sji-android-screen-capture
===================
<b>Android Screen Capture (For HTML5 Video Live Streaming)</b>  
This project is aimed to capture android screen and view it in HTML5 video capable browser.  
Yes, real time, low bandwidth.  This product will do encoding in host and android by <a href="http://ffmpeg.org/">ffmpeg</a>.
Support Chrome, Firefox, Safari. Windows/Linux/Unix
<pre><code><a href="http://youtu.be/CWcOjzAJ6Sg">recorded video sample( converted by youtube)</a>  
<a href="http://youtu.be/1wZYHHzMwQ8">Usage video</a></code></pre>

<b>New</b>: Recorded file can be auto converted to <b>H.264/MP4</b> and <b>WebM</b> video format if you'v installed ffmpeg in local PC.<br/>

[Screenshot]

Menu<br/>
<img src="doc/screenshot-menu.png" /><br/>
Live View<br/>
<img src="doc/screenshot-png.png" /><br/>
Recorded Videos<br/>
<img src="doc/recorded.png" /><br/>

[How to use]  
  
1.<b>Setup PC Environment (Windows/Mac/Linux/Unix)</b>  
<pre><code><a href="http://developer.android.com/sdk/index.html">Install Android SDK</a> (at least "Platform Tools" which include adb(Android Debug Bridge)).  
<a href="http://nodejs.org/download/">install node.js</a>.  
Install android USB driver automatically or manually when you first plug Android into PC.  
If you want to always record as H.264/MP4 or WebM video format, you need <a href="http://www.ffmpeg.org/download.html">install FFMPEG into PC</a>.
</code></pre>
To simplify other settings, you'd better put the directory of adb and local ffmpeg into PATH environment variable otherwise you need put the fullpath of them into "adb" and "ffmpeg" settings in stream.json file.
<br/><br/>
3.<b>Start Android Screen Capture (include a video stream server) on PC</b>  
<pre><code>cd path_of_this_project/bin  
node stream.js
</code></pre>
You can edit configuration file <a href="https://raw.github.com/sjitech/sji-android-screen-capture/master/bin/stream.json">stream.json</a> to change IP, port, SSL...  
<br/><br/>
4.<b>Show video/animated image of android from PC by browsing <a href="http://localhost:3000/">http://localhost:3000/</a></b>  <br/>
Support <a href="http://www.webmproject.org/">WebM</a> video and <a href="http://en.wikipedia.org/wiki/H.264/MPEG-4_AVC">H.264/MP4</a> and Animated JPEG/PNG by <a href="http://en.wikipedia.org/wiki/MIME#Mixed-Replace">Multi-Part HTTP Response</a>.
Chrome,Firefox,Safari are well supported. IE10+ is not tested but should be OK.
<br/><br/>
To embed Animated JPEG image into your html page:
<pre><code>&lt;img src="http://localhost:33333/capture?device=yourDeviceSerialNumber&type=ajpg&fps=4" /&gt;
</code></pre>

To embed Animated PNG image into your html page. (PNG is lostless image compression):
<pre><code>&lt;img src="http://localhost:33333/capture?device=yourDeviceSerialNumber&type=apng&fps=4" /&gt;
</code></pre>

You can record and seamlessly convert to H.264/MP4 and WebM format file.
To record, you submit a HTTP GET request with following URL:
<pre><code>http://localhost:3000/deviceControl?action=startRecording?device=yourDeviceSerialNumber&type=ajpg&fps=4" /&gt;
</code></pre>
or via animated PNG  (better quality than above URL)
<pre><code>http://localhost:3000/deviceControl?action=startRecording?device=yourDeviceSerialNumber&type=ajpg&fps=4" /&gt;
</code></pre>

To stop recording, you submit a HTTP GET request with following URL:
<pre><code>http://localhost:3000/deviceControl?action=stopRecording?device=yourDeviceSerialNumber" /&gt;
</code></pre>

To just capture one screenshot:
JPEG:
<pre><code>&lt;img src="http://localhost:33333/capture?device=yourDeviceSerialNumber&type=jpg" /&gt;
</code></pre>
PNG:
<pre><code>&lt;img src="http://localhost:33333/capture?device=yourDeviceSerialNumber&type=png" /&gt;
</code></pre>

[Note]:
All above URLs can specify scale and rotate optionally by append following querystring:
<pre>
&scale=0.5&rotate=270 or  
&scale=300xAuto or
&scale=300x200 or  
&scale=Autox200 ...
</pre>  
  
For advanced usage, please start menu page, move mouse to link and button to see URL.  
<br/>
<br/>
You can attach an access key for device so all above URL must  appended &accessKey=yourAccessKey otherwise you get "access denied" error response.  
Typically stream web server administrator set adminKey e.g. xxxx,   
then submit URL request:  
<pre>  
http://localhost:3000/deviceControl?adminKey=xxxx&action=setAccessKey&accessKey=yyyy&device=sn1&device=sn2  ....  
</pre>  
This will attach access key yyyy to device sn1 and sn2.  
  
To start record Animated PNG image, you can submit following URL request:  
<pre>  
http://localhost:3000/deviceControl?adminKey=xxxx&action=startRecording&device=sn1&device=sn2&type=apng&fps=4  
</pre>  
  
This will start record on device sn1 and sn2. The fps means rate. You can optionally specify scale and rotate querystring.  
  
To stop record Animated PNG image, embed following URL into your HTML img tag:  
<pre>  
http://localhost:3000/deviceControl?adminKey=xxxx&action=stopRecording&device=sn1&device=sn2    
</pre>  
  
To play record file Animated PNG image, embed following URL into your HTML img tag:  
<pre>  
http://localhost:33333/playRecordedFile?&device=sn1&accessKey=yyyy&type=apng  
</pre>  
  
You can optionally specify custom playback rate by fps querystring.  

To download record file Animated PNG image, embed following URL into your HTML page:  
<pre>  
http://localhost:33333/downlodRecordedFile?&device=sn1&accessKey=yyyy&type=apng  
</pre>  
  
For webm format, just change apng to webm and img tag to video tag in above steps.   

===================  
[Note]  
    Currently tested in android 4.2, 4.1, 4.0, 2.2, 2.3.  With PC Browser Chrome 33, Firefox 27, Safari 7.
    Host OS can be Windows/Mac/Linux (Unix should also be OK, but not tested).  
    Build: src/build_all.sh has been tested in Mac OS X 10.7 64bit and Ubuntu 12 64bit,
    Android NDK r8 or r9. Gcc 4.4.3 or 4.8.  
    bin/android/busybox is downloaded from <a href="http://www.busybox.net/downloads/binaries/latest/busybox-armv5l">busybox binary downloads</a>.
