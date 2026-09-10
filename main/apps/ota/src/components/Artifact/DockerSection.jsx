import React from 'react'
import { Dropdown, Input, Button, Tag } from '@repo/ui'
import { VersionContainer } from '@repo/ui/styles'
import { DropdownContainer } from '@/pages/Artifact/styles'

const DockerSection = ({
  t,
  id,
  status,
  packageType,
  moduleId,
  moduleOptions,
  handleModuleChange,
  artifactFile,
  setArtifactFile,
  manifestFile,
  setManifestFile,
  version,
  setVersion,
  versions,
  addVersion,
  handleDeleteTag
}) => {
  return (
    <>
      <DropdownContainer>
        <Dropdown
          label={t('module')}
          size="lg"
          value={moduleId}
          placeholder={t('selectModule')}
          options={moduleOptions}
          showSearch={true}
          onChange={handleModuleChange}
          disabled={id !== undefined && id !== null}
        />
      </DropdownContainer>
      <DropdownContainer>
        <Input
          type="file"
          label={t('fileArtifact')}
          size="lg"
          value={artifactFile?.fileName || ''}
          onChange={(e) => setArtifactFile(e.target?.files[0] || artifactFile)}
          onReset={() => setArtifactFile(null)}
          disabled={id !== undefined && id !== null && (status === 'IN_PROGRESS' || status === 'SUCCESS')}
        />
        {packageType?.needScript && (
          <Input
            type="file"
            label={t('fileManifest')}
            size="lg"
            value={manifestFile?.fileName || ''}
            onChange={(e) => setManifestFile(e.target?.files[0] || manifestFile)}
            onReset={() => setManifestFile(null)}
            disabled={id !== undefined && id !== null && (status === 'IN_PROGRESS' || status === 'SUCCESS')}
          />
        )}
      </DropdownContainer>
      <VersionContainer>
        <div className="version-label">Tag</div>
        <div className="version-wrapper">
          <div className={`version-input-group ${!moduleId || (id !== undefined && id !== null) ? 'disabled' : ''}`}>
            <Input
              value={version}
              size="sm"
              style={{ width: '20rem' }}
              onChange={(e) => setVersion(e.target.value)}
              type="text"
              disabled={id !== undefined && id !== null}
              onKeyDown={(e) => e.key === 'Enter' && version && addVersion()}
            />
            <Button variant="contained" onClick={addVersion} disabled={(id !== undefined && id !== null) || !version}>
              +
            </Button>
          </div>
          <div className="version-list">
            {versions.map((ver, index) => (
              <div key={index} className="tag">
                <Tag
                  variant="contained"
                  size="sm"
                  onClick={() => (id === undefined || id === null) && handleDeleteTag(index)}
                >
                  {ver}
                  {(id === undefined || id === null) && (
                    <span
                      className="close-icon"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteTag(index)
                      }}
                    >
                      ✕
                    </span>
                  )}
                </Tag>
              </div>
            ))}
          </div>
        </div>
      </VersionContainer>
    </>
  )
}

export default DockerSection
