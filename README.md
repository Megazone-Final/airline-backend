# airline-backend

This repository owns backend application code, service-level changes, and image publication to ECR.

## Services

- `auth`
- `flights`
- `payments`

## Delivery Boundary

- Build, test, and publish Docker images from this repository
- Keep runtime deployment state in `../airline-infra`
- Do not treat this repository as the source of truth for EKS manifests or ArgoCD applications
