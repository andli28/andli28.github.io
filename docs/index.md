# Andrew Li

Notes on machine learning and systems.

A policy gradient step:

$$
\nabla_\theta J(\theta) = \mathbb{E}\big[\nabla_\theta \log \pi_\theta(a \mid s) \, A(s, a)\big]
$$

The logistic function is $\sigma(z) = (1 + e^{-z})^{-1}$.
