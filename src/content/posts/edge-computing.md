---
author: 'Jakub Kołodziejczak'
title: 'My journey with edge computing'
pubDate: 2021-06-03
image: 'https://blog.cloudflare.com/content/images/2018/10/Artboard-42@3x.png'
description: 'What are V8 Isolates and why Cloudflare is betting on them?'
tags: [
    'cloudflare',
    'edge',
    'v8',
    'isolates',
    'cloud',
]
---

Soon I will take a final exam of [Software Engineering postgraduate
studies](http://www.cs.put.poznan.pl/spio/) at Poznań University of Technology.
One of the postgrads subjects is an IT project that we are finalizing. We
figured that it would be nice to serve the beta release widely in internet and
that it could be deployed to cloud.

So I took the task and after some research (mostly involving free tier offers)
I've chosen [Cloudflare Workers](https://workers.cloudflare.com/) which turned
out to be a great stuff when it comes to developer experience and features
available for free out of the box.

Killer features of this solution are that it's not burdened with cold starts +
runs at the cloud edge - close to the end users. Obviously this improves
response times and saves bandwidth. WORLD WIDE.

But OK, why it's like this? Here is the keyword: [V8
isolates](https://www.infoq.com/presentations/cloudflare-v8/). I really
recommend [Cloud Computing without
Containers](https://blog.cloudflare.com/cloud-computing-without-containers/)
blog post by [Zack Bloom](https://blog.cloudflare.com/author/zack-bloom/) if
you want to know more details. With this [you can use languages that compile to
either JavaScript or
WASM](https://developers.cloudflare.com/workers/platform/languages).

Looks like AWS also spotted isolate's potential and [they've recently released
a similar solution: CloudFront
Functions](https://aws.amazon.com/blogs/aws/introducing-cloudfront-functions-run-your-code-at-the-edge-with-low-latency-at-any-scale/)
which is different to Lambda@Edge.  However if you dig further you will quickly
realize that it's not that rich as Cloudflare Workers and (at least for now)
[it's limited only to
JavaScript](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/edge-functions.html).

Anyway, two things are certain for me when it comes to edge computing: this is
something that will have more and more use cases by the time and that
Cloudflare is way ahead of AWS[1] currently in this area.


---

Image taken from Cloudflare blog post by Zack Bloom: https://blog.cloudflare.com/cloud-computing-without-containers/

[1] the context here is that isolates might be the next paradigm shift in the cloud and so far they've received much more attention from Cloudflare than from AWS

This post was origially published (behind authwall) at
https://www.linkedin.com/pulse/my-journey-edge-computing-jakub-ko%25C5%2582odziejczak
