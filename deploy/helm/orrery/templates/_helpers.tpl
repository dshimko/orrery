{{- /* SPDX-License-Identifier: Apache-2.0 */ -}}
{{- define "orrery.name" -}}
{{- .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "orrery.fullname" -}}
{{- if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "orrery.labels" -}}
app.kubernetes.io/name: {{ include "orrery.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "orrery.selectorLabels" -}}
app.kubernetes.io/name: {{ include "orrery.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
